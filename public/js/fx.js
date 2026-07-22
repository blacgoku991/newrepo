'use strict';

/* Algonis — micro-interactions premium :
 * - curseur custom (dot + ring)
 * - boutons magnétiques
 * - ripple au clic
 * - spotlight suivant la souris sur cartes
 * - reveal au scroll
 * - marquee auto-cloné
 */

(function () {
  const fine = window.matchMedia('(hover:hover) and (pointer:fine)').matches;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Custom cursor ----------
  if (fine && !reduce) {
    const dot = document.createElement('div');
    dot.className = 'cursor-dot';
    const ring = document.createElement('div');
    ring.className = 'cursor-ring';
    document.body.appendChild(dot); document.body.appendChild(ring);

    let mx = -100, my = -100, rx = -100, ry = -100;
    window.addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; }, { passive: true });

    function loop() {
      dot.style.transform = `translate3d(${mx - 3}px,${my - 3}px,0)`;
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
      ring.style.transform = `translate3d(${rx - 17}px,${ry - 17}px,0)`;
      requestAnimationFrame(loop);
    }
    loop();

    const hoverSel = 'a,button,.app-tile,.choice,input,select,textarea,label';
    document.addEventListener('mouseover', (e) => {
      if (e.target.closest(hoverSel)) ring.classList.add('is-hover');
    });
    document.addEventListener('mouseout', (e) => {
      if (e.target.closest(hoverSel)) ring.classList.remove('is-hover');
    });
  }

  // ---------- Magnetic buttons ----------
  if (fine && !reduce) {
    document.querySelectorAll('.btn').forEach((btn) => {
      btn.addEventListener('mousemove', (e) => {
        const r = btn.getBoundingClientRect();
        const x = e.clientX - r.left - r.width / 2;
        const y = e.clientY - r.top - r.height / 2;
        btn.style.transform = `translate(${x * 0.18}px,${y * 0.22}px)`;
        btn.style.setProperty('--mx', `${e.clientX - r.left}px`);
        btn.style.setProperty('--my', `${e.clientY - r.top}px`);
      });
      btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
    });
  }

  // ---------- Ripple ----------
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn');
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const rip = document.createElement('span');
    rip.className = 'ripple';
    const size = Math.max(r.width, r.height);
    rip.style.width = rip.style.height = `${size}px`;
    rip.style.left = `${e.clientX - r.left - size / 2}px`;
    rip.style.top = `${e.clientY - r.top - size / 2}px`;
    btn.appendChild(rip);
    setTimeout(() => rip.remove(), 700);
  });

  // ---------- Card spotlight ----------
  document.addEventListener('mousemove', (e) => {
    const tile = e.target.closest('.app-tile');
    if (!tile) return;
    const r = tile.getBoundingClientRect();
    tile.style.setProperty('--mx', `${e.clientX - r.left}px`);
    tile.style.setProperty('--my', `${e.clientY - r.top}px`);
  });

  // ---------- Reveal on scroll ----------
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
  } else {
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-in'));
  }

  // ---------- Auto-clone marquee ----------
  document.querySelectorAll('.ticker-track').forEach((track) => {
    track.innerHTML = track.innerHTML + track.innerHTML;
  });

  // ---------- Page veil auto-remove ----------
  const veil = document.querySelector('.page-veil');
  if (veil) setTimeout(() => veil.remove(), 1000);
})();
