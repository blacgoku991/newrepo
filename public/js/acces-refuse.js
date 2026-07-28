'use strict';

/*
 * Écran d'accès refusé.
 *
 * Il s'affiche quand la connexion Microsoft 365 a réussi mais que la personne
 * n'est pas habilitée sur ce portail. C'est un moment désagréable : la page
 * doit dire ce qui se passe, avec quel compte, et à qui s'adresser — plutôt
 * qu'un code d'erreur qui laisse l'utilisateur appeler le support pour rien.
 */

(function () {
  const params = new URLSearchParams(location.search);

  // Le compte concerné est passé par le serveur. Il est affiché tel quel, dans
  // du texte : `textContent` ne peut rien interpréter, même si le paramètre
  // était forgé.
  const compte = params.get('compte');
  if (compte) {
    document.getElementById('refus-compte').textContent = compte;
    document.getElementById('refus-identite').hidden = false;
  }

  // Message adapté au motif, sans jamais révéler la règle d'habilitation :
  // décrire précisément ce qu'il faudrait pour entrer aiderait surtout ceux
  // qui n'ont rien à y faire.
  const MOTIFS = {
    ferme: 'L’accès à ce portail est réservé aux personnes déclarées par votre organisation. Votre compte n’en fait pas partie pour le moment.',
    desactive: 'Votre habilitation à ce portail a été désactivée. Votre administrateur peut la rétablir.',
    // Panne ou connexion interrompue : rien à voir avec une habilitation, le
    // titre et la marche à suivre changent donc aussi.
    echec: 'La connexion Microsoft 365 n’a pas abouti. Cela peut venir d’une session expirée ou d’une interruption pendant l’authentification.',
  };
  const cle = params.get('motif');
  const motif = MOTIFS[cle];
  if (motif) document.getElementById('refus-message').textContent = motif;
  if (cle === 'echec') {
    // Ce n'est pas un refus d'accès : ne pas l'annoncer comme tel.
    document.querySelector('h1').textContent = 'La connexion n’a pas abouti';
    document.querySelector('.refus-marche').innerHTML =
      '<h2>Que faire ?</h2><ol><li>Réessayez de vous connecter : le plus souvent, cela suffit.</li>'
      + '<li>Si le problème persiste, signalez-le à l’administrateur du portail de votre organisation.</li></ol>';
    document.getElementById('refus-changer').textContent = 'Réessayer';
  }

  // Se reconnecter suppose de quitter la session en cours : sans cela,
  // Microsoft renverrait aussitôt le même compte.
  document.getElementById('refus-changer').addEventListener('click', async () => {
    try {
      await fetch('/auth/sso/logout', { method: 'POST', credentials: 'same-origin' });
    } catch { /* la session expirera d'elle-même */ }
    location.href = '/connexion';
  });

  // Mention de l'éditeur en pied de page, une fois la marque connue.
  document.addEventListener('DOMContentLoaded', () => {
    const m = typeof marqueCourante === 'function' ? marqueCourante() : null;
    if (m) document.getElementById('refus-pied').textContent = `${m.societe} — ${m.mention}`;
  });
})();
