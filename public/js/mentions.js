'use strict';

/*
 * Mentions légales, politique de confidentialité et information sur les
 * cookies.
 *
 * La page n'écrit rien en dur : tout vient du serveur. Les coordonnées sont
 * celles que l'organisation a saisies dans son administration, et les DURÉES DE
 * CONSERVATION sont celles que la purge applique réellement. Recopier ces
 * durées à la main reviendrait à annoncer une politique que le code ne suit
 * pas — c'est la première chose qu'un contrôle vérifie.
 */

(function () {
  const zone = document.getElementById('legal');
  if (!zone) return;

  const jours = (n) => {
    if (n === 0) return 'effacé dès le traitement terminé';
    if (n === 1) return '1 jour';
    if (n < 60) return `${n} jours`;
    if (n < 365) return `${Math.round(n / 30)} mois`;
    const a = n / 365;
    return a === 1 ? '1 an' : `${Number(a.toFixed(1))} ans`;
  };

  // Un champ non renseigné se voit : mieux vaut « à compléter » lisible qu'une
  // ligne vide, que personne ne remarquera jamais.
  const val = (v) => (v ? escapeHtml(v) : '<span class="todo">à compléter par l’organisation</span>');

  fetch('/api/conformite', { credentials: 'same-origin' })
    .then((r) => r.json())
    .then((d) => rendre(d))
    .catch(() => {
      zone.innerHTML = '<h1>Mentions légales</h1><p class="alert alert-error">'
        + 'Ces informations ne peuvent pas être affichées pour le moment.</p>';
    });

  function rendre(d) {
    const v = d.valeurs || {};
    const societe = escapeHtml(d.societe || 'votre organisation');
    document.title = `Mentions légales — ${d.societe || 'Portail comptes'}`;

    zone.innerHTML = `
      <h1>Mentions légales et protection des données</h1>
      <p class="lede">Portail interne de création et d’administration des comptes applicatifs de ${societe}.</p>

      <section id="editeur">
        <h2>Éditeur du portail</h2>
        <dl>
          <dt>Organisation</dt><dd>${val(v.raisonSociale || d.societe)}</dd>
          <dt>Forme juridique</dt><dd>${val(v.formeJuridique)}</dd>
          <dt>SIREN / SIRET</dt><dd>${val(v.siren)}</dd>
          <dt>Siège social</dt><dd>${val(v.siege)}</dd>
          <dt>Directeur de la publication</dt><dd>${val(v.directeurPublication)}</dd>
          <dt>Contact</dt><dd>${val(v.contact)}</dd>
        </dl>
        <p>Ce portail est un outil <strong>strictement interne</strong>, réservé aux personnes
          habilitées de ${societe}. L’accès est protégé par l’authentification Microsoft 365 de
          l’organisation, et limité aux comptes déclarés comme référents.</p>
        <p>Le logiciel est édité par <strong>${escapeHtml(d.editeurOutil || 'Smartfixx')}</strong>,
          qui l’héberge et l’exploite pour le compte de ${societe} en qualité de
          <strong>sous-traitant</strong> au sens de l’article 28 du RGPD. ${societe} demeure
          responsable de traitement.</p>
      </section>

      <section id="hebergement">
        <h2>Hébergement</h2>
        <p>${val(v.hebergeur)}</p>
        <p>Les données sont hébergées dans l’Union européenne. Aucun transfert hors de l’Union
          n’est réalisé dans le cadre de ce service.</p>
      </section>

      <section id="propriete">
        <h2>Propriété intellectuelle</h2>
        <p>L’interface, les textes et les éléments graphiques du portail sont la propriété de
          ${escapeHtml(d.editeurOutil || 'Smartfixx')}, à l’exception des marques et éléments
          fournis par ${societe}.</p>
        <p>Les marques et logos <strong>BlueKanGo</strong> et <strong>NetSoins</strong> (Orisha)
          appartiennent à leurs éditeurs respectifs et ne servent ici qu’à identifier les
          applications concernées. Aucun partenariat n’est sous-entendu.</p>
      </section>

      <section id="confidentialite">
        <h2>Politique de confidentialité</h2>

        <h3>Qui traite les données, et pourquoi</h3>
        <p>${societe} est <strong>responsable de traitement</strong>. Le portail sert à créer,
          modifier et administrer les comptes des salariés sur les applications métiers, et à
          garder la trace de ces opérations.</p>

        <h3>Base légale</h3>
        <p><strong>Intérêt légitime</strong> de l’organisation à administrer les accès de ses
          salariés aux outils nécessaires à leur travail, et à en assurer la sécurité
          (article 6.1.f du RGPD). Aucune donnée n’est utilisée à d’autres fins, ni cédée, ni
          vendue, et aucune décision automatisée produisant des effets juridiques n’est prise.</p>

        <h3>Données traitées</h3>
        <ul>
          <li><strong>Personne qui dépose la demande</strong> : nom, prénom et adresse
            professionnelle issus du compte Microsoft 365, établissements sur lesquels elle est
            habilitée ;</li>
          <li><strong>Salarié concerné par le compte</strong> : civilité, nom, prénom, fonction,
            établissement, adresse professionnelle, dates de contrat, identifiant créé ;</li>
          <li><strong>Traçabilité</strong> : horodatage, action réalisée, adresse IP ;</li>
          <li><strong>Diagnostic</strong> : captures d’écran prises par le robot pendant le
            traitement, susceptibles de montrer les écrans de l’application métier.</li>
        </ul>
        <p>Les <strong>mots de passe ne sont jamais conservés</strong> : ils sont remis par un lien
          à usage unique, chiffré, qui expire.</p>

        <h3>Qui y a accès</h3>
        <p>Les administrateurs du portail désignés par ${societe}, et les référents de chaque
          établissement — ces derniers uniquement pour leur propre périmètre. Le personnel de
          ${escapeHtml(d.editeurOutil || 'Smartfixx')} n’accède aux données que sur demande de
          ${societe}, pour une intervention technique, et cet accès est tracé.</p>

        <h3>Combien de temps</h3>
        <p>Ces durées sont celles que le portail applique automatiquement : une purge passe au
          démarrage puis toutes les six heures.</p>
        <div class="tbl"><table>
          <thead><tr><th>Catégorie</th><th>Contenu</th><th>Finalité</th><th>Durée</th></tr></thead>
          <tbody>${(d.conservation || []).map((c) => `<tr>
            <td><b>${escapeHtml(c.libelle)}</b></td>
            <td>${escapeHtml(c.contenu)}</td>
            <td>${escapeHtml(c.finalite)}</td>
            <td><b>${escapeHtml(jours(c.jours))}</b></td></tr>`).join('')}</tbody>
        </table></div>

        <h3>Vos droits</h3>
        <p>Vous disposez d’un droit d’accès, de rectification, d’effacement, de limitation et
          d’opposition sur vos données, ainsi que d’un droit à la portabilité. L’administration du
          portail dispose d’un outil dédié permettant de réunir, d’exporter et d’effacer en une
          fois tout ce qui vous concerne.</p>
        <p>Pour l’exercer, adressez-vous au délégué à la protection des données :
          ${val(v.dpoNom)}${v.dpoContact ? ` — ${escapeHtml(v.dpoContact)}` : ''}.</p>
        <p>Le journal de sécurité fait exception à l’effacement : les événements y sont conservés,
          mais <strong>anonymisés</strong> — savoir qu’un accès a eu lieu reste nécessaire à la
          sécurité du système (article 17.3 du RGPD).</p>
        <p>Vous pouvez également introduire une réclamation auprès de la
          <a href="https://www.cnil.fr" target="_blank" rel="noreferrer noopener">CNIL</a>.</p>

        <h3>Sécurité</h3>
        <ul>
          <li>Accès réservé aux comptes Microsoft 365 explicitement déclarés ;</li>
          <li>Chiffrement des échanges (HTTPS) et des secrets au repos (AES-256-GCM) ;</li>
          <li>Mots de passe des comptes d’administration hachés (scrypt), jamais réversibles ;</li>
          <li>Base de données propre à chaque organisation, sur un processus distinct ;</li>
          <li>Sauvegardes quotidiennes chiffrables, et journal de toutes les actions sensibles.</li>
        </ul>
      </section>

      <section id="cookies">
        <h2>Cookies</h2>
        <p>Le portail ne dépose <strong>que des cookies strictement nécessaires</strong> à son
          fonctionnement. Il n’y a ni mesure d’audience, ni publicité, ni traceur tiers — et donc
          rien à accepter ou à refuser : ces cookies ne peuvent pas être désactivés sans empêcher
          la connexion.</p>
        <div class="tbl"><table>
          <thead><tr><th>Cookie</th><th>Rôle</th><th>Durée</th><th>Nature</th></tr></thead>
          <tbody>${(d.cookies || []).map((c) => `<tr>
            <td><code>${escapeHtml(c.nom)}</code></td>
            <td>${escapeHtml(c.role)}</td>
            <td>${escapeHtml(c.duree)}</td>
            <td>${c.necessaire ? 'Strictement nécessaire' : 'Facultatif'}</td></tr>`).join('')}</tbody>
        </table></div>
        <p>Aucune ressource n’est chargée depuis un site tiers : polices, images et scripts sont
          servis par le portail lui-même. Votre navigateur ne contacte donc personne d’autre.</p>
      </section>

      <p style="margin-top:34px"><a href="/">← Retour à l’accueil</a></p>`;
  }
})();
