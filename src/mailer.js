'use strict';

/**
 * Envoi des e-mails d'identifiants après création réussie d'un compte.
 *
 * - Si SMTP est configuré (SMTP_HOST + SMTP_USER + SMTP_PASS), on envoie
 *   réellement via nodemailer.
 * - Sinon, l'e-mail est simplement déposé dans la boîte d'envoi (table outbox,
 *   visible dans le panel admin) avec le statut « à envoyer » : l'admin peut
 *   copier le message et le transmettre à la main.
 *
 * Le mot de passe initial n'est JAMAIS stocké dans la table requests : il ne
 * vit que dans le corps de l'e-mail (outbox / SMTP).
 */

const db = require('./db');
const registry = require('./registry');
const { generateLogin } = require('./automation/identifiants');

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function buildMessage(appName, data, reference, storedLogin, credentialLink, type = 'creation') {
  const isReset = type === 'reset_mdp';
  const isExtension = type === 'ajout_etab';
  const beneficiaire = `${data.prenom || ''} ${data.nom || ''}`.trim();
  const frDate = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
  };

  const lines = [
    `Bonjour${beneficiaire ? ' ' + beneficiaire : ''},`,
    '',
    isReset
      ? `Le mot de passe de votre compte ${appName} a été réinitialisé.`
      : isExtension
        ? `Un nouvel établissement a été ajouté à votre compte ${appName}.`
        : `Votre compte ${appName} a été créé.`,
    '',
    `Application    : ${appName}`,
  ];
  if (frDate(data.date_debut)) lines.push(`Valide du      : ${frDate(data.date_debut)}`);
  if (frDate(data.date_fin)) lines.push(`Valide jusqu'au: ${frDate(data.date_fin)}`);
  lines.push(`Référence      : ${reference}`);
  lines.push('');

  if (credentialLink) {
    // AUCUN secret dans l'e-mail : lien sécurisé à usage unique.
    lines.push('Récupérez votre identifiant et votre mot de passe provisoire ici :');
    lines.push('');
    lines.push(`    ${credentialLink.url}`);
    lines.push('');
    lines.push(`⚠ Ce lien ne peut être consulté qu'UNE SEULE fois et expire dans ${credentialLink.ttlDays} jours.`);
    lines.push('  Le mot de passe est provisoire : il devra être changé à la première connexion.');
    lines.push('  Lien déjà utilisé ou expiré ? Contactez votre administrateur pour en recevoir un nouveau.');
  } else {
    // Repli (aucun lien généré) : on ne divulgue que l'identifiant.
    const login = storedLogin || (data.prenom && data.nom ? generateLogin(data.prenom, data.nom) : null);
    if (login) lines.push(`Identifiant    : ${login}`);
    lines.push('Le mot de passe initial vous sera communiqué par votre administrateur.');
  }
  lines.push('');
  lines.push('Cet e-mail est généré automatiquement par Algonis, le portail de création de comptes ADEF Résidences.');

  return {
    subject: isReset
      ? `Votre mot de passe ${appName} a été réinitialisé — récupérez vos identifiants`
      : isExtension
        ? `Nouvel établissement ajouté à votre compte ${appName}`
        : `Votre compte ${appName} est prêt — récupérez vos identifiants`,
    text: lines.join('\n'),
  };
}

/** Destinataire : bénéficiaire en priorité, sinon demandeur. */
function pickRecipient(data) {
  return (data.email || '').trim() || (data._demandeur_email || '').trim() || '';
}

/**
 * Prépare et tente l'envoi de l'e-mail d'identifiants pour une demande terminée.
 * Retourne { queuedId, sent } ou null si aucun destinataire.
 */
async function sendCredentials(request, credentialLink = null) {
  const data = JSON.parse(request.payload);
  const to = pickRecipient(data);
  if (!to) return null;

  const appEntry = registry.get(request.app_id);
  const appName = appEntry ? appEntry.config.name : request.app_id;
  const { subject, text } = buildMessage(appName, data, request.reference, request.generated_login, credentialLink, request.request_type || 'creation');

  const outboxId = db.createOutbox(request.id, to, subject, text);
  await deliver(outboxId);
  db.audit('robot', smtpConfigured() ? 'email_identifiants_envoye' : 'email_identifiants_en_attente', request.reference, to);
  return { queuedId: outboxId, sent: smtpConfigured() };
}

/** Tente l'envoi SMTP d'un e-mail de la boîte d'envoi (met à jour son statut). */
async function deliver(outboxId) {
  const mail = db.getOutbox(outboxId);
  if (!mail) return;
  if (!smtpConfigured()) {
    // Pas de SMTP : reste « à envoyer » pour traitement manuel dans l'admin.
    return;
  }
  try {
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false') === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transport.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: mail.to_email,
      subject: mail.subject,
      text: mail.body_text,
    });
    db.setOutboxStatus(outboxId, 'envoye');
  } catch (err) {
    db.setOutboxStatus(outboxId, 'erreur', String(err.message).slice(0, 300));
  }
}

module.exports = { sendCredentials, deliver, smtpConfigured };
