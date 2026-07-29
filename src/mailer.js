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
const demarches = require('./demarches');
const marque = require('./marque');
const { generateLogin } = require('./automation/identifiants');

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function buildMessage(appName, data, reference, storedLogin, credentialLink, type = 'creation') {
  const isReset = type === 'reset_mdp';
  const isExtension = type === 'ajout_etab';
  // Correction d'identité : l'identifiant de connexion a pu changer (il suit le
  // nom). Le mot de passe, lui, n'est pas touché — il ne faut donc rien
  // promettre à ce sujet.
  const isIdentite = type === 'maj_identite';
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
        : isIdentite
          ? `Votre identité a été corrigée sur votre compte ${appName}.`
          : `Votre compte ${appName} a été créé.`,
    '',
    `Application    : ${appName}`,
  ];
  if (frDate(data.date_debut)) lines.push(`Valide du      : ${frDate(data.date_debut)}`);
  if (frDate(data.date_fin)) lines.push(`Valide jusqu'au: ${frDate(data.date_fin)}`);
  lines.push(`Référence      : ${reference}`);
  lines.push('');

  if (credentialLink && isIdentite) {
    // Correction d'identité : l'identifiant a changé, le mot de passe non. Il
    // passe quand même par le lien à usage unique — un identifiant de connexion
    // n'a pas à circuler en clair dans une boîte mail.
    lines.push('Récupérez votre nouvel identifiant de connexion ici :');
    lines.push('');
    lines.push(`    ${credentialLink.url}`);
    lines.push('');
    lines.push(`⚠ Ce lien ne peut être consulté qu'UNE SEULE fois et expire dans ${credentialLink.ttlDays} jours.`);
    lines.push('  Votre mot de passe n\'a pas changé : continuez à utiliser celui que vous connaissez.');
    lines.push('  Lien déjà utilisé ou expiré ? Contactez votre administrateur pour en recevoir un nouveau.');
  } else if (credentialLink) {
    // AUCUN secret dans l'e-mail : lien sécurisé à usage unique.
    lines.push('Récupérez votre identifiant et votre mot de passe provisoire ici :');
    lines.push('');
    lines.push(`    ${credentialLink.url}`);
    lines.push('');
    lines.push(`⚠ Ce lien ne peut être consulté qu'UNE SEULE fois et expire dans ${credentialLink.ttlDays} jours.`);
    lines.push('  Le mot de passe est provisoire : il devra être changé à la première connexion.');
    lines.push('  Lien déjà utilisé ou expiré ? Contactez votre administrateur pour en recevoir un nouveau.');
  } else if (isIdentite) {
    // Aucun secret ici : seul l'identifiant a changé, le mot de passe reste
    // celui que le titulaire utilise déjà.
    if (storedLogin) {
      lines.push(`Nouvel identifiant de connexion : ${storedLogin}`);
      lines.push('');
      lines.push('Utilisez désormais cet identifiant pour vous connecter.');
    }
    lines.push('Votre mot de passe reste inchangé.');
  } else {
    // Repli (aucun lien généré) : on ne divulgue que l'identifiant.
    const login = storedLogin || (data.prenom && data.nom ? generateLogin(data.prenom, data.nom) : null);
    if (login) lines.push(`Identifiant    : ${login}`);
    lines.push('Le mot de passe initial vous sera communiqué par votre administrateur.');
  }
  lines.push('');
  // La marque vient de l'instance : ce texte était en dur, et chaque client
  // aurait envoyé à ses salariés un e-mail signé du nom d'un autre.
  lines.push(`Cet e-mail est généré automatiquement par le portail de création de comptes de ${marque.etat().societe}.`);

  return {
    subject: isReset
      ? `Votre mot de passe ${appName} a été réinitialisé — récupérez vos identifiants`
      : isExtension
        ? `Nouvel établissement ajouté à votre compte ${appName}`
        : isIdentite
          ? `Votre identifiant ${appName} a changé`
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

/**
 * Prévient le déposant que sa demande est traitée.
 *
 * Sans cela, le référent dépose puis revient voir, parfois plusieurs fois. Et
 * surtout : un échec passait inaperçu jusqu'à ce que le salarié se plaigne de ne
 * pas pouvoir se connecter — c'est-à-dire au pire moment.
 *
 * L'e-mail va au DÉPOSANT, jamais au bénéficiaire : c'est le référent qui doit
 * agir en cas d'échec, et le bénéficiaire reçoit déjà ses identifiants par le
 * lien sécurisé. Il ne porte aucun identifiant ni mot de passe : ce message
 * traverse une messagerie ordinaire.
 */
async function notifierDeposant(request) {
  const data = JSON.parse(request.payload);
  // `sso_email` d'abord : c'est le serveur qui l'a écrit, depuis la session
  // Microsoft 365. `_demandeur_email` vient du formulaire — le serveur l'écrase
  // quand le SSO est actif, mais sans SSO il resterait choisi par l'appelant,
  // et le portail deviendrait un relais pour expédier du courrier n'importe où.
  const to = String(request.sso_email || data._demandeur_email || '').trim();
  if (!to) return null;
  // Le bénéficiaire reçoit ses identifiants par ailleurs : lui envoyer en plus
  // un accusé de traitement n'apporte rien et double le bruit.
  if (to.toLowerCase() === String(data.email || '').trim().toLowerCase()) return null;

  const appEntry = registry.get(request.app_id);
  const appName = appEntry ? appEntry.config.name : request.app_id;
  const demarche = demarches.get(request.request_type || 'creation');
  const intitule = demarche ? demarche.label.toLowerCase() : 'demande';
  const qui = `${data.prenom || ''} ${data.nom || ''}`.trim() || 'le compte concerné';
  const reussi = request.status === 'terminee';

  const subject = reussi
    ? `[${request.reference}] ${appName} — ${intitule} effectuée`
    : `[${request.reference}] ${appName} — ${intitule} en échec`;

  const text = reussi
    ? `Bonjour,\n\n`
      + `Votre demande ${request.reference} (${intitule} sur ${appName}) pour ${qui} a été traitée.\n\n`
      + (request.generated_login ? `Identifiant créé : ${request.generated_login}\n\n` : '')
      + `${qui} peut récupérer ses identifiants depuis le portail, à la page de suivi.\n`
      + `Aucun mot de passe ne circule par e-mail.\n\n`
      + `— ${marque.etat().societe}\n`
    : `Bonjour,\n\n`
      + `Votre demande ${request.reference} (${intitule} sur ${appName}) pour ${qui} n'a pas abouti.\n\n`
      + `Motif : ${request.result_message || 'non précisé'}\n\n`
      + `Vous pouvez la redéposer depuis le portail après avoir vérifié les informations saisies.\n`
      + `Si le problème persiste, signalez-le à l'administrateur du portail.\n\n`
      + `— ${marque.etat().societe}\n`;

  const outboxId = db.createOutbox(request.id, to, subject, text);
  await deliver(outboxId);
  db.audit('robot', reussi ? 'notification_succes' : 'notification_echec', request.reference, to);
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

module.exports = { sendCredentials, notifierDeposant, deliver, smtpConfigured };
