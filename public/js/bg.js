'use strict';

/* Algonis — Holographic 3D scene.
 * Three.js via ESM CDN with graceful canvas fallback.
 * Renders a wireframe icosahedron crystal + orbiting torus rings +
 * a shimmering particle field, with cursor-parallax camera.
 */

(async function () {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  try {
    const THREE = await import('https://esm.sh/three@0.160.0');
    await initThree(THREE, canvas, reduce);
  } catch (err) {
    console.warn('[bg] Three.js unavailable, fallback 2D', err);
    initCanvasFallback(canvas);
  }
})();

async function initThree(THREE, canvas, reduce) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x04050b, 8, 22);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 9);

  // Lights
  const ambient = new THREE.AmbientLight(0x6a95ff, 0.35);
  scene.add(ambient);
  const l1 = new THREE.PointLight(0x22d3ee, 6, 30);
  l1.position.set(-6, 3, 5); scene.add(l1);
  const l2 = new THREE.PointLight(0x8a5cff, 5, 30);
  l2.position.set(6, -2, 4); scene.add(l2);
  const l3 = new THREE.PointLight(0xff5ec4, 3, 30);
  l3.position.set(0, 5, 2); scene.add(l3);

  // --- Central crystal (icosahedron wireframe + glass core) ---
  const group = new THREE.Group();
  scene.add(group);

  const coreGeo = new THREE.IcosahedronGeometry(1.2, 1);
  const coreMat = new THREE.MeshPhysicalMaterial({
    color: 0x1a2a6b,
    metalness: 0.6,
    roughness: 0.15,
    transmission: 0.85,
    thickness: 0.8,
    envMapIntensity: 1.2,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    transparent: true,
    opacity: 0.6,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  group.add(core);

  const wireGeo = new THREE.IcosahedronGeometry(1.35, 1);
  const wireMat = new THREE.MeshBasicMaterial({ color: 0x7ff2ff, wireframe: true, transparent: true, opacity: 0.55 });
  const wire = new THREE.Mesh(wireGeo, wireMat);
  group.add(wire);

  const wire2Geo = new THREE.IcosahedronGeometry(1.75, 0);
  const wire2Mat = new THREE.MeshBasicMaterial({ color: 0xb48bff, wireframe: true, transparent: true, opacity: 0.28 });
  const wire2 = new THREE.Mesh(wire2Geo, wire2Mat);
  group.add(wire2);

  // --- Orbiting torus rings ---
  const rings = [];
  const ringColors = [0x22d3ee, 0x8a5cff, 0xff5ec4];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.TorusGeometry(2.2 + i * 0.6, 0.008, 8, 160);
    const m = new THREE.MeshBasicMaterial({ color: ringColors[i], transparent: true, opacity: 0.5 });
    const r = new THREE.Mesh(g, m);
    r.rotation.x = Math.PI / 2 + i * 0.3;
    r.rotation.y = i * 0.6;
    rings.push(r);
    scene.add(r);
  }

  // --- Floating cubes / crystals ---
  const floaters = [];
  const shapes = [
    new THREE.OctahedronGeometry(0.18, 0),
    new THREE.TetrahedronGeometry(0.22, 0),
    new THREE.IcosahedronGeometry(0.16, 0),
  ];
  for (let i = 0; i < 14; i++) {
    const g = shapes[i % shapes.length];
    const color = [0x7ff2ff, 0xb48bff, 0xff9ee0][i % 3];
    const m = new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.7 });
    const mesh = new THREE.Mesh(g, m);
    const angle = (i / 14) * Math.PI * 2;
    const radius = 3.6 + Math.random() * 1.4;
    mesh.position.set(Math.cos(angle) * radius, (Math.random() - 0.5) * 3, Math.sin(angle) * radius - 1);
    mesh.userData = {
      speed: 0.2 + Math.random() * 0.4,
      offset: Math.random() * Math.PI * 2,
      radius,
      angle,
      yBase: mesh.position.y,
    };
    floaters.push(mesh);
    scene.add(mesh);
  }

  // --- Particle field ---
  const pCount = 1200;
  const positions = new Float32Array(pCount * 3);
  const colors = new Float32Array(pCount * 3);
  const palette = [
    [0.24, 0.42, 1.0],
    [0.54, 0.36, 1.0],
    [0.13, 0.83, 0.93],
    [1.0, 0.37, 0.77],
  ];
  for (let i = 0; i < pCount; i++) {
    const r = 4 + Math.random() * 10;
    const t = Math.random() * Math.PI * 2;
    const p = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(p) * Math.cos(t);
    positions[i * 3 + 1] = r * Math.sin(p) * Math.sin(t) * 0.6;
    positions[i * 3 + 2] = r * Math.cos(p) - 2;
    const c = palette[i % palette.length];
    colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const pMat = new THREE.PointsMaterial({
    size: 0.035, vertexColors: true, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(pGeo, pMat);
  scene.add(points);

  // --- Resize ---
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  // --- Mouse parallax ---
  let mx = 0, my = 0, tmx = 0, tmy = 0;
  window.addEventListener('mousemove', (e) => {
    tmx = (e.clientX / window.innerWidth - 0.5) * 2;
    tmy = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  // --- Animate ---
  const clock = new THREE.Clock();
  let visible = true;
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; });

  function animate() {
    if (!visible) { requestAnimationFrame(animate); return; }
    const t = clock.getElapsedTime();
    const dt = Math.min(clock.getDelta ? 0.016 : 0.016, 0.033);

    // Smooth parallax
    mx += (tmx - mx) * 0.05;
    my += (tmy - my) * 0.05;
    camera.position.x = mx * 0.9;
    camera.position.y = -my * 0.6;
    camera.lookAt(0, 0, 0);

    // Crystal
    group.rotation.y = t * 0.15;
    group.rotation.x = Math.sin(t * 0.3) * 0.2;
    wire.rotation.x = t * 0.4;
    wire.rotation.z = t * 0.2;
    wire2.rotation.y = -t * 0.25;
    wire2.rotation.x = t * 0.15;
    const s = 1 + Math.sin(t * 1.4) * 0.03;
    core.scale.set(s, s, s);

    // Rings
    rings.forEach((r, i) => {
      r.rotation.z = t * (0.15 + i * 0.05) * (i % 2 ? -1 : 1);
      r.rotation.x = Math.PI / 2 + Math.sin(t * 0.3 + i) * 0.2;
    });

    // Floaters
    floaters.forEach((f) => {
      const u = f.userData;
      u.angle += dt * u.speed * 0.2;
      f.position.x = Math.cos(u.angle) * u.radius;
      f.position.z = Math.sin(u.angle) * u.radius - 1;
      f.position.y = u.yBase + Math.sin(t * u.speed + u.offset) * 0.4;
      f.rotation.x += dt * u.speed;
      f.rotation.y += dt * u.speed * 0.7;
    });

    // Points slow rotation
    points.rotation.y = t * 0.02;

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();
}

function initCanvasFallback(canvas) {
  const ctx = canvas.getContext('2d');
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0, h = 0;
  const particles = [];
  const COLORS = ['59,109,255', '138,92,255', '34,211,238', '90,139,255'];
  function resize() {
    w = canvas.clientWidth = window.innerWidth;
    h = canvas.clientHeight = window.innerHeight;
    canvas.width = w * DPR; canvas.height = h * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  function seed() {
    particles.length = 0;
    for (let i = 0; i < 60; i++) particles.push({
      x: Math.random() * w, y: Math.random() * h, z: Math.random() * .8 + .2,
      vx: (Math.random() - .5) * .15, vy: (Math.random() - .5) * .15,
      r: Math.random() * 1.8 + .6, c: COLORS[(Math.random() * COLORS.length) | 0],
    });
  }
  let mx = w / 2, my = h / 2;
  window.addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; }, { passive: true });
  function frame() {
    ctx.clearRect(0, 0, w, h);
    for (const p of particles) {
      p.x += p.vx + (mx - w / 2) * .00008 * p.z;
      p.y += p.vy + (my - h / 2) * .00008 * p.z;
      if (p.x < -20) p.x = w + 20; if (p.x > w + 20) p.x = -20;
      if (p.y < -20) p.y = h + 20; if (p.y > h + 20) p.y = -20;
      const r = p.r * (.6 + p.z);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 6);
      g.addColorStop(0, `rgba(${p.c},${.9 * p.z})`);
      g.addColorStop(1, `rgba(${p.c},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, r * 6, 0, Math.PI * 2); ctx.fill();
    }
    requestAnimationFrame(frame);
  }
  resize(); seed(); frame();
  window.addEventListener('resize', () => { resize(); seed(); });
}
