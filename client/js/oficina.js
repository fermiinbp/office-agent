/*
 * The Agent Office — motor de la oficina.
 *
 * Secciones:
 *   1. Utilidades y carga del equipo (servidor → .md cargados → config)
 *   2. Escena, rejilla de navegación (A*) y edificio
 *   3. Héroes 3D
 *   4. Agentes: horario, rutas y animación
 *   5. Simulación de issues (cuando no hay eventos reales)
 *   6. Modo en directo (eventos de los hooks de Claude Code vía /api/eventos)
 *   7. Ciclo día/noche, kanban y etiquetas
 *   8. Chat con los héroes
 *   9. Panel, barra y bucle principal
 */
(async () => {
  'use strict';

  /* =====================================================================
     1. UTILIDADES Y CARGA DEL EQUIPO
     ===================================================================== */
  const CFG = window.OFFICE_CONFIG;
  const $ = (s) => document.querySelector(s);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const fmtTok = (n) =>
    n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n));
  const hash = (s) => {
    let h = 0;
    for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return h;
  };
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v ? JSON.parse(v) : d;
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch (e) {
        /* almacenamiento no disponible */
      }
    },
    del(k) {
      try {
        localStorage.removeItem(k);
      } catch (e) {
        /* nada */
      }
    },
  };

  /* lee el frontmatter de un .md de subagente de Claude Code */
  function parseAgentMd(text, filename) {
    const fm = {};
    let body = text;
    const m = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
    if (m) {
      body = text.slice(m[0].length);
      m[1].split(/\r?\n/).forEach((l) => {
        const k = l.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
        if (k) fm[k[1].toLowerCase()] = k[2].replace(/^["']|["']$/g, '').trim();
      });
    }
    const clean = (s) =>
      s
        .replace(/<example>[\s\S]*?<\/example>/gi, '')
        .replace(/\\n/g, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const rules = [...body.matchAll(/^\s*(?:[-*]|\d+\.)\s+(.+)$/gm)]
      .map((b) => b[1].replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim())
      .filter((b) => b.length > 3)
      .slice(0, 6);
    return {
      name: (fm.name || filename.replace(/\.md$/i, '')).trim(),
      description: clean(
        fm.description || body.split('\n').find((l) => l.trim() && !l.startsWith('#')) || 'Agente sin descripción.',
      ).slice(0, 300),
      tools: (fm.tools || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      model: fm.model || '',
      color: fm.color || '',
      rules,
    };
  }

  /* origen del equipo: servidor local → agentes cargados a mano → config */
  let server = null;
  if (location.protocol.startsWith('http')) {
    try {
      const r = await fetch('api/estado');
      if (r.ok) server = await r.json();
    } catch (e) {
      server = null;
    }
  }
  let mdAgents = null,
    source = '';
  if (server) {
    try {
      const r = await fetch('api/agentes');
      if (r.ok) mdAgents = await r.json();
      source = `Agentes leídos de ${server.agentesDir}`;
    } catch (e) {
      mdAgents = null;
    }
  }
  if (!mdAgents || !mdAgents.length) {
    mdAgents = store.get('ao-agentes', null);
    source = 'Agentes cargados desde tu carpeta (guardados en este navegador).';
  }
  if (!mdAgents || !mdAgents.length) {
    mdAgents = CFG.agentesPorDefecto;
    source = 'Agentes de ejemplo de config.js. Arranca el servidor o pulsa «Cargar agentes» para usar los tuyos.';
  }
  mdAgents = mdAgents.filter((a) => a && a.name).slice(0, CFG.maxAgentes || 9);

  /* héroe generado para un agente que no está en config.js */
  const AUTO = ['#e5484d', '#3e7bfa', '#2ea44f', '#e0b028', '#8a5cf6', '#f2843a', '#ef5fa7', '#1fb5c6', '#9b8cff'];
  const SKINS = ['#f1c7a4', '#e0a67e', '#c68459', '#8d5a3b', '#f5d6bd'];
  const HAIRS = ['#2b1d14', '#5a3b22', '#c7883a', '#1c1c24', '#8a2b2b', '#e8d27a'];
  const darken = (hex, f) => '#' + new THREE.Color(hex).multiplyScalar(f).getHexString();
  function autoHero(md, i) {
    const h = hash(md.name),
      base = AUTO[(h + i) % AUTO.length];
    const acc = ['mask', 'antenna', 'headphones', 'monocle', 'none'][h % 5];
    return {
      name: md.name.charAt(0).toUpperCase() + md.name.slice(1),
      title: 'agente del escuadrón',
      persona: 'profesional y cercano; habla de su trabajo con orgullo',
      look: {
        suit: base,
        suit2: darken(base, 0.45),
        boot: darken(base, 0.25),
        skin: SKINS[(h >> 3) % SKINS.length],
        hair: HAIRS[(h >> 5) % HAIRS.length],
        mask: acc === 'mask' ? darken(base, 0.2) : null,
        antenna: acc === 'antenna',
        headphones: acc === 'headphones',
        monocle: acc === 'monocle',
        emblem: ['hex', 'square', 'tri', 'ring', 'diamond', 'shield'][(h >> 2) % 6],
        accent: base,
      },
    };
  }
  const BOSS = { id: 'boss', boss: true, ...CFG.jefe };
  const workerDefs = mdAgents.map((md, i) => {
    const hero = (CFG.heroes && CFG.heroes[md.name]) || autoHero(md, i);
    return {
      id: 'w' + i,
      agent: md.name,
      name: hero.name,
      title: hero.title,
      persona: hero.persona,
      look: hero.look,
      frases: hero.frases,
      model: md.model || '—',
      desc: md.description,
      rules: md.rules || [],
      tools: md.tools || [],
    };
  });

  /* orden del pipeline: el de config.js si encaja con el equipo, si no se deduce */
  function buildStageNames() {
    const names = workerDefs.map((d) => d.agent);
    if (Array.isArray(CFG.pipeline)) {
      const st = CFG.pipeline.map((s) => s.filter((n) => names.includes(n))).filter((s) => s.length);
      const covered = new Set(st.flat());
      if (st.length && names.every((n) => covered.has(n))) return st;
      if (st.length)
        return [...st.slice(0, -1), ...names.filter((n) => !covered.has(n)).map((n) => [n]), ...st.slice(-1)];
    }
    const by = (re) => workerDefs.filter((d) => re.test(d.desc)).map((d) => d.agent);
    const first = by(/primero/i),
      last = by(/al final/i).filter((n) => !first.includes(n));
    const impl = workerDefs
      .filter((d) => /^implementa/i.test(d.desc) && !first.includes(d.agent) && !last.includes(d.agent))
      .map((d) => d.agent);
    const rest = names.filter((n) => !first.includes(n) && !last.includes(n) && !impl.includes(n));
    return [
      ...(first.length ? [first] : []),
      ...(impl.length ? [impl] : []),
      ...rest.map((n) => [n]),
      ...(last.length ? [last] : []),
    ];
  }
  const stageNames = buildStageNames();
  /* las mesas siguen el orden del pipeline */
  const ordered = stageNames.flat().map((n) => workerDefs.find((d) => d.agent === n));
  ordered.forEach((d, i) => {
    d.id = 'w' + i;
  });
  const HEROES = [BOSS, ...ordered];
  const COLOR = Object.fromEntries(HEROES.map((h) => [h.id, h.look.accent || h.look.suit]));

  /* =====================================================================
     2. ESCENA, REJILLA Y EDIFICIO
     ===================================================================== */
  const sceneEl = $('#scene');
  let renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (e) {
    sceneEl.insertAdjacentHTML(
      'beforeend',
      '<div class="glerr">Tu navegador no ha podido iniciar WebGL, así que la oficina 3D no se puede dibujar. El chat y el panel siguen funcionando.</div>',
    );
  }
  THREE.ColorManagement.legacyMode = false;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 300);
  camera.position.set(23, 27, 29);
  let controls = null;
  if (renderer) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    sceneEl.prepend(renderer.domElement);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(-0.6, 0, 0.6);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = 1.28;
    controls.minDistance = 8;
    controls.maxDistance = 60;
  }

  const matCache = new Map();
  function mat(color, opts = {}) {
    const key = color + JSON.stringify(opts);
    if (!matCache.has(key))
      matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...opts }));
    return matCache.get(key);
  }
  function box(w, h, d, color, x, y, z, parent = scene, opts) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'string' ? mat(color, opts) : color);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function cyl(rt, rb, h, color, x, y, z, parent = scene, seg = 20, opts) {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(rt, rb, h, seg),
      typeof color === 'string' ? mat(color, opts) : color,
    );
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  /* --- rejilla de navegación (A*) --- */
  const GX0 = -15,
    GZ0 = -10,
    CELL = 0.5,
    GW = 60,
    GH = 40;
  const blocked = new Uint8Array(GW * GH);
  const rects = [];
  function block(x1, z1, x2, z2, pad = 0.32) {
    rects.push([Math.min(x1, x2) - pad, Math.min(z1, z2) - pad, Math.max(x1, x2) + pad, Math.max(z1, z2) + pad]);
  }
  function buildGrid() {
    for (let j = 0; j < GH; j++)
      for (let i = 0; i < GW; i++) {
        const cx = GX0 + (i + 0.5) * CELL,
          cz = GZ0 + (j + 0.5) * CELL;
        let b = cx < -14.6 || cx > 14.7 || cz < -9.6 || cz > 9.7;
        for (const r of rects)
          if (cx > r[0] && cx < r[2] && cz > r[1] && cz < r[3]) {
            b = true;
            break;
          }
        blocked[j * GW + i] = b ? 1 : 0;
      }
  }
  const toCell = (x, z) => [
    Math.max(0, Math.min(GW - 1, Math.floor((x - GX0) / CELL))),
    Math.max(0, Math.min(GH - 1, Math.floor((z - GZ0) / CELL))),
  ];
  const cellCenter = (i, j) => [GX0 + (i + 0.5) * CELL, GZ0 + (j + 0.5) * CELL];
  const isFree = (i, j) => i >= 0 && j >= 0 && i < GW && j < GH && !blocked[j * GW + i];
  function nearestFree(i, j) {
    if (isFree(i, j)) return [i, j];
    for (let r = 1; r < 12; r++) {
      let best = null,
        bd = 1e9;
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          if (isFree(i + di, j + dj)) {
            const d = di * di + dj * dj;
            if (d < bd) {
              bd = d;
              best = [i + di, j + dj];
            }
          }
        }
      if (best) return best;
    }
    return [i, j];
  }
  function lineFree(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az),
      n = Math.max(1, Math.ceil(d / 0.2));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const [i, j] = toCell(ax + (bx - ax) * t, az + (bz - az) * t);
      if (!isFree(i, j)) return false;
    }
    return true;
  }
  function findPath(sx, sz, tx, tz) {
    const [si, sj] = nearestFree(...toCell(sx, sz));
    const [ti, tj] = nearestFree(...toCell(tx, tz));
    const start = sj * GW + si,
      goal = tj * GW + ti;
    const g = new Float32Array(GW * GH).fill(Infinity),
      f = new Float32Array(GW * GH).fill(Infinity);
    const came = new Int32Array(GW * GH).fill(-1),
      closed = new Uint8Array(GW * GH);
    const h = (n) => {
      const dx = Math.abs((n % GW) - ti),
        dy = Math.abs(((n / GW) | 0) - tj);
      return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
    };
    const open = [start];
    g[start] = 0;
    f[start] = h(start);
    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
      const cur = open[bi];
      open.splice(bi, 1);
      if (cur === goal) break;
      closed[cur] = 1;
      const ci = cur % GW,
        cj = (cur / GW) | 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di,
            nj = cj + dj;
          if (!isFree(ni, nj)) continue;
          if (di && dj && (!isFree(ci + di, cj) || !isFree(ci, cj + dj))) continue;
          const nb = nj * GW + ni;
          if (closed[nb]) continue;
          const ng = g[cur] + (di && dj ? 1.414 : 1);
          if (ng < g[nb]) {
            g[nb] = ng;
            f[nb] = ng + h(nb);
            came[nb] = cur;
            if (!open.includes(nb)) open.push(nb);
          }
        }
    }
    if (start !== goal && came[goal] === -1) return null;
    const cells = [];
    for (let n = goal; n !== -1; n = came[n]) {
      cells.push(cellCenter(n % GW, (n / GW) | 0));
      if (n === start) break;
    }
    cells.reverse();
    const pts = [[sx, sz], ...cells.slice(1), [tx, tz]];
    const out = [pts[0]];
    let a = 0;
    while (a < pts.length - 1) {
      let b = pts.length - 1;
      while (b > a + 1 && !lineFree(pts[a][0], pts[a][1], pts[b][0], pts[b][1])) b--;
      out.push(pts[b]);
      a = b;
    }
    return out.slice(1);
  }

  /* --- texturas --- */
  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    if (repeat) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat[0], repeat[1]);
    }
    return t;
  }
  const woodTex = canvasTex(
    512,
    512,
    (g, w, h) => {
      g.fillStyle = '#c9a77c';
      g.fillRect(0, 0, w, h);
      const rows = 8;
      for (let r = 0; r < rows; r++) {
        let x = (r % 2) * -128;
        while (x < w) {
          const pw = 192 + ((r * 37 + x) % 3) * 32,
            l = 0.9 + ((r * 13 + x * 7) % 10) / 70;
          g.fillStyle = `rgb(${Math.round(201 * l)},${Math.round(167 * l)},${Math.round(124 * l)})`;
          g.fillRect(x + 1, r * (h / rows) + 1, pw - 2, h / rows - 2);
          g.strokeStyle = 'rgba(90,60,30,.18)';
          for (let k = 0; k < 3; k++) {
            g.beginPath();
            const yy = r * (h / rows) + 10 + k * 18;
            g.moveTo(x + 8, yy);
            g.bezierCurveTo(x + pw / 3, yy + 4, x + pw / 2, yy - 4, x + pw - 8, yy + 2);
            g.stroke();
          }
          x += pw;
        }
      }
    },
    [6, 4],
  );
  const tileTex = canvasTex(
    256,
    256,
    (g, w, h) => {
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) {
          g.fillStyle = (i + j) % 2 ? '#e9e4da' : '#d4cdbf';
          g.fillRect(i * 64, j * 64, 64, 64);
        }
      g.strokeStyle = '#bdb4a3';
      g.lineWidth = 2;
      for (let k = 0; k <= 4; k++) {
        g.beginPath();
        g.moveTo(k * 64, 0);
        g.lineTo(k * 64, h);
        g.moveTo(0, k * 64);
        g.lineTo(w, k * 64);
        g.stroke();
      }
    },
    [3, 3],
  );
  const carpetTex = (base, line) =>
    canvasTex(
      256,
      256,
      (g, w, h) => {
        g.fillStyle = base;
        g.fillRect(0, 0, w, h);
        g.strokeStyle = line;
        g.lineWidth = 3;
        for (let k = -h; k < w; k += 22) {
          g.beginPath();
          g.moveTo(k, 0);
          g.lineTo(k + h, h);
          g.stroke();
        }
      },
      [3, 3],
    );
  const kanbanCanvas = document.createElement('canvas');
  kanbanCanvas.width = 1024;
  kanbanCanvas.height = 600;
  const kanbanTex = new THREE.CanvasTexture(kanbanCanvas);
  kanbanTex.encoding = THREE.sRGBEncoding;
  kanbanTex.anisotropy = 4;

  /* --- luces --- */
  const hemi = new THREE.HemisphereLight('#cfe0ff', '#7a6248', 0.6);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight('#ffffff', 0.12);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight('#fff1d6', 1.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 20, bottom: -20, near: 1, far: 90 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);
  const moon = new THREE.DirectionalLight('#8ea8ff', 0);
  moon.position.set(-20, 30, 10);
  scene.add(moon);
  const lamps = [];
  /* sin techo: la luz de cada sala no lleva lámpara visible; las lámparas de pie sí se ven */
  function roomLight(x, z, y = 2.8) {
    const light = new THREE.PointLight('#ffd29a', 0, 11, 2);
    light.position.set(x, y, z);
    scene.add(light);
    lamps.push({ light });
  }
  function floorLamp(x, z) {
    cyl(0.18, 0.2, 0.04, '#2a2d3a', x, 0.02, z, scene, 20);
    cyl(0.02, 0.02, 1.55, '#2a2d3a', x, 0.8, z, scene, 8);
    const shade = cyl(
      0.14,
      0.24,
      0.3,
      new THREE.MeshStandardMaterial({
        color: '#f6e7c8',
        emissive: '#ffcf8a',
        emissiveIntensity: 0,
        roughness: 0.8,
        side: THREE.DoubleSide,
      }),
      x,
      1.65,
      z,
      scene,
      24,
    );
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 12, 10),
      new THREE.MeshStandardMaterial({ color: '#fff4dc', emissive: '#ffd29a', emissiveIntensity: 0 }),
    );
    bulb.position.set(x, 1.6, z);
    scene.add(bulb);
    const light = new THREE.PointLight('#ffd29a', 0, 6, 2);
    light.position.set(x, 1.5, z);
    scene.add(light);
    lamps.push({ light, bulb, shade });
    block(x - 0.2, z - 0.2, x + 0.2, z + 0.2, 0.2);
  }

  /* --- edificio --- */
  const WALL = '#ece7f0',
    WALL_DARK = '#d5cfdc',
    FRAME = '#2f3445';
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 20),
    new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.8 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: '#46553f', roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  scene.add(ground);
  box(30.6, 0.3, 20.6, '#8c8798', 0, -0.16, 0).castShadow = false;
  function zoneFloor(x1, z1, x2, z2, material, y = 0.004) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x2 - x1, z2 - z1), material);
    m.rotation.x = -Math.PI / 2;
    m.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
    m.receiveShadow = true;
    m.material.polygonOffset = true;
    m.material.polygonOffsetFactor = -1;
    scene.add(m);
    return m;
  }
  zoneFloor(6, -10, 15, -2, new THREE.MeshStandardMaterial({ map: carpetTex('#2d3a5c', '#33426a'), roughness: 0.95 }));
  zoneFloor(
    -15,
    -10,
    -6,
    -2,
    new THREE.MeshStandardMaterial({ map: carpetTex('#5b3f5e', '#654869'), roughness: 0.95 }),
  );
  zoneFloor(8.5, 3, 15, 10, new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.5 }));
  zoneFloor(-14.8, 4.2, -9.8, 9.8, new THREE.MeshStandardMaterial({ color: '#c9b48f', roughness: 1 }), 0.006);

  const winMat = new THREE.MeshStandardMaterial({
    color: '#9fcbff',
    emissive: '#9fcbff',
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0.55,
    roughness: 0.1,
  });
  function windowWall(axis, fixed, from, to, openings) {
    const T = 0.2,
      H = 3;
    const seg = (a, b, y1, y2, color = WALL) => {
      const len = b - a,
        mid = (a + b) / 2,
        h = y2 - y1;
      if (len <= 0.01) return;
      if (axis === 'x') box(len, h, T, color, mid, y1 + h / 2, fixed);
      else box(T, h, len, color, fixed, y1 + h / 2, mid);
    };
    seg(from, to, 0, 0.12, '#8a8296');
    seg(from, to, 0.12, 0.9);
    seg(from, to, 2.45, H);
    let cur = from;
    for (const [a, b] of openings) {
      seg(cur, a, 0.9, 2.45);
      const len = b - a,
        mid = (a + b) / 2;
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.55), winMat);
      if (axis === 'x') glass.position.set(mid, 1.675, fixed);
      else {
        glass.position.set(fixed, 1.675, mid);
        glass.rotation.y = Math.PI / 2;
      }
      scene.add(glass);
      const n = Math.max(1, Math.round(len / 1.6));
      for (let k = 1; k < n; k++) {
        const p = a + (len * k) / n;
        if (axis === 'x') box(0.06, 1.55, 0.08, FRAME, p, 1.675, fixed);
        else box(0.08, 1.55, 0.06, FRAME, fixed, 1.675, p);
      }
      if (axis === 'x') box(len, 0.06, 0.3, '#f6f3fa', mid, 0.93, fixed + 0.1);
      else box(0.3, 0.06, len, '#f6f3fa', fixed + 0.1, 0.93, mid);
      cur = b;
    }
    seg(cur, to, 0.9, 2.45);
    if (axis === 'x') block(from, fixed - 0.1, to, fixed + 0.1, 0.35);
    else block(fixed - 0.1, from, fixed + 0.1, to, 0.35);
  }
  windowWall('x', -10.1, -15.2, 15.2, [
    [-13.6, -7.4],
    [-4.6, 4.6],
    [7.4, 14],
  ]);
  windowWall('z', -15.1, -10, 10.2, [
    [-8.6, -3.4],
    [-0.6, 2.6],
    [5.2, 9],
  ]);
  box(0.2, 0.28, 20.4, WALL_DARK, 15.1, 0.14, 0);
  box(30.4, 0.28, 0.2, WALL_DARK, 0, 0.14, 10.1);
  block(14.9, -10, 15.3, 10.2, 0.3);
  block(-15.2, 9.9, 15.3, 10.3, 0.3);

  const glassMat = new THREE.MeshStandardMaterial({
    color: '#cfe6ff',
    transparent: true,
    opacity: 0.16,
    roughness: 0.05,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  function glassWall(axis, fixed, from, to) {
    const len = to - from,
      mid = (from + to) / 2;
    const g = new THREE.Mesh(new THREE.PlaneGeometry(len, 2.7), glassMat);
    if (axis === 'x') g.position.set(mid, 1.45, fixed);
    else {
      g.position.set(fixed, 1.45, mid);
      g.rotation.y = Math.PI / 2;
    }
    g.renderOrder = 2;
    scene.add(g);
    if (axis === 'x') {
      box(len, 0.1, 0.1, FRAME, mid, 0.05, fixed);
      box(len, 0.1, 0.1, FRAME, mid, 2.85, fixed);
    } else {
      box(0.1, 0.1, len, FRAME, fixed, 0.05, mid);
      box(0.1, 0.1, len, FRAME, fixed, 2.85, mid);
    }
    const n = Math.max(1, Math.round(len / 2));
    for (let k = 0; k <= n; k++) {
      const p = from + (len * k) / n;
      if (axis === 'x') box(0.08, 2.9, 0.08, FRAME, p, 1.45, fixed);
      else box(0.08, 2.9, 0.08, FRAME, fixed, 1.45, p);
    }
    if (axis === 'x') block(from, fixed - 0.05, to, fixed + 0.05, 0.32);
    else block(fixed - 0.05, from, fixed + 0.05, to, 0.32);
  }
  glassWall('z', 6, -10, -2);
  glassWall('x', -2, 6, 9.8);
  glassWall('x', -2, 11.4, 15); /* despacho del jefe */
  glassWall('z', -6, -10, -2);
  glassWall('x', -2, -15, -11.6);
  glassWall('x', -2, -10, -6); /* sala de reuniones */

  /* --- mobiliario y puntos donde se colocan los héroes --- */
  const SPOTS = {};
  const spot = (id, x, z, ry, pose, seatH = 0) => (SPOTS[id] = { id, x, z, ry, pose, seatH });
  const faceTo = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
  function chair(x, z, ry, color = '#3a4058', seatTop = 0.45, back = true) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    scene.add(g);
    box(0.5, 0.07, 0.48, color, 0, seatTop - 0.035, -0.08, g);
    if (back) box(0.48, 0.55, 0.06, color, 0, seatTop + 0.33, -0.36, g);
    cyl(0.03, 0.03, seatTop - 0.1, '#20232f', 0, (seatTop - 0.07) / 2 + 0.03, -0.08, g, 10);
    cyl(0.26, 0.26, 0.04, '#20232f', 0, 0.03, -0.08, g, 5);
    return g;
  }
  const screens = {};
  function desk(key, x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    scene.add(g);
    box(1.8, 0.06, 0.8, '#e4d8c3', 0, 0.73, 0, g);
    for (const sx of [-0.84, 0.84]) for (const sz of [-0.34, 0.34]) box(0.05, 0.7, 0.05, '#2a2d3a', sx, 0.35, sz, g);
    box(1.7, 0.42, 0.03, '#d2c5ad', 0, 0.48, -0.36, g);
    box(0.08, 0.24, 0.06, '#1d2030', 0, 0.88, -0.18, g);
    box(0.32, 0.02, 0.2, '#1d2030', 0, 0.77, -0.18, g);
    box(0.8, 0.48, 0.04, '#1d2030', 0, 1.2, -0.16, g);
    const scr = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.4),
      new THREE.MeshStandardMaterial({ color: '#0c1020', emissive: '#0c1020', emissiveIntensity: 1, roughness: 0.3 }),
    );
    scr.position.set(0, 1.2, -0.138);
    g.add(scr);
    screens[key] = scr;
    box(0.48, 0.02, 0.15, '#e9e9f0', -0.05, 0.77, 0.12, g);
    box(0.06, 0.02, 0.1, '#e9e9f0', 0.38, 0.77, 0.14, g);
    cyl(0.045, 0.04, 0.1, '#f4f0e8', 0.68, 0.81, 0.05, g, 14);
    block(x - 0.9, z - 0.4, x + 0.9, z + 0.4);
  }
  function plant(x, z, s = 1) {
    cyl(0.22 * s, 0.17 * s, 0.42 * s, '#b0643a', x, 0.21 * s, z, scene, 16);
    [
      [0, 0.85, 0, 0.36],
      [0.16, 0.7, 0.1, 0.26],
      [-0.15, 0.72, -0.08, 0.27],
      [0.02, 1.1, -0.05, 0.24],
    ].forEach(([dx, y, dz, r], i) => {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r * s, 1), mat(i % 2 ? '#52ad6f' : '#3c8f5a'));
      m.position.set(x + dx * s, y * s, z + dz * s);
      m.castShadow = true;
      scene.add(m);
    });
    block(x - 0.25 * s, z - 0.25 * s, x + 0.25 * s, z + 0.25 * s, 0.25);
  }

  /* zona de trabajo: hasta 9 puestos en filas de 3 */
  const COLS = [-7, -2.8, 1.4],
    ROWS = [0.4, 4.6, 7.6];
  ordered.forEach((d, i) => {
    const x = COLS[i % 3],
      z = ROWS[Math.floor(i / 3)];
    desk(d.id, x, z);
    chair(x, z + 0.95, Math.PI);
    spot('desk-' + d.id, x, z + 0.95, Math.PI, 'sit', 0.45);
  });
  {
    const g = new THREE.Group();
    g.position.set(4.6, 0, -1.05);
    scene.add(g);
    box(2.4, 1.45, 0.06, '#f7f5ef', 0, 1.55, 0, g);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(2.3, 1.35),
      new THREE.MeshStandardMaterial({ map: kanbanTex, roughness: 0.6 }),
    );
    face.position.set(0, 1.55, 0.035);
    g.add(face);
    for (const sx of [-1.1, 1.1]) box(0.06, 0.85, 0.06, '#2a2d3a', sx, 0.42, 0, g);
    box(2.5, 0.04, 0.2, '#2a2d3a', 0, 0.82, 0.05, g);
    block(3.4, -1.15, 5.8, -0.95, 0.3);
    spot('board', 4.6, 0.3, Math.PI, 'stand');
  }
  plant(-4.9, -1.4);
  plant(5.4, 8.9, 1.2);
  plant(-9.1, 2.6, 0.9);
  plant(7.2, 1.8);
  box(0.7, 0.75, 0.55, '#e2e2ea', 5.6, 0.375, 6.2);
  box(0.6, 0.1, 0.45, '#9aa0b5', 5.6, 0.8, 6.2);
  block(5.25, 5.9, 5.95, 6.5);

  /* despacho del jefe */
  {
    const g = new THREE.Group();
    g.position.set(10.8, 0, -6.4);
    g.rotation.y = Math.PI;
    scene.add(g);
    box(2.4, 0.08, 0.95, '#5a3a24', 0, 0.74, 0, g);
    box(0.1, 0.72, 0.9, '#4a2f1c', -1.12, 0.36, 0, g);
    box(0.1, 0.72, 0.9, '#4a2f1c', 1.12, 0.36, 0, g);
    box(2.2, 0.5, 0.05, '#4a2f1c', 0, 0.45, -0.42, g);
    for (const sx of [-0.45, 0.45]) {
      box(0.07, 0.24, 0.06, '#1d2030', sx, 0.9, -0.2, g);
      box(0.72, 0.44, 0.04, '#1d2030', sx, 1.22, -0.18, g);
    }
    const scr = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 0.38),
      new THREE.MeshStandardMaterial({ color: '#0c1020', emissive: '#0c1020', emissiveIntensity: 1 }),
    );
    scr.position.set(0, 1.22, -0.158);
    g.add(scr);
    screens.boss = scr;
    box(0.5, 0.02, 0.15, '#e9e9f0', 0, 0.79, 0.15, g);
    cyl(0.05, 0.06, 0.18, '#d9a521', 0.95, 0.87, 0.1, g, 16, { metalness: 0.7, roughness: 0.3 });
    block(9.6, -6.9, 12, -5.9);
    const c = chair(10.8, -7.4, 0, '#2a2018', 0.48, false);
    box(0.56, 0.95, 0.08, '#2a2018', 0, 1.0, -0.38, c);
    spot('desk-boss', 10.8, -7.4, 0, 'sit', 0.48);
    box(2.2, 2.2, 0.38, '#4a2f1c', 13.4, 1.1, -9.7);
    for (let s = 0; s < 4; s++)
      for (let b = 0; b < 7; b++) {
        const c2 = ['#c8352e', '#2f7fe0', '#d9a521', '#3c8f5a', '#6a4bc4', '#efece4'][(s * 3 + b) % 6];
        box(0.18, 0.36 + ((s + b) % 3) * 0.04, 0.26, c2, 12.55 + b * 0.27, 0.3 + s * 0.52, -9.55);
      }
    block(12.3, -9.9, 14.5, -9.5);
    box(0.85, 0.45, 2.2, '#1f6f78', 14.45, 0.225, -4);
    box(0.25, 0.85, 2.2, '#1a5d65', 14.8, 0.43, -4);
    block(14.0, -5.1, 15, -2.9, 0.25);
    spot('night-boss', 13.7, -4, -Math.PI / 2, 'sleep', 0.45);
    plant(6.8, -9.2, 1.1);
    floorLamp(13.2, -2.6);
    zoneFloor(9, -8.6, 12.6, -5, new THREE.MeshStandardMaterial({ color: '#b5843f', roughness: 1 }), 0.008);
  }

  /* sala de reuniones: 6 sillas + cabecera para el jefe + 3 sitios de pie */
  const MEET = [
    [-11.5, -7.45, 0],
    [-10.5, -7.45, 0],
    [-9.5, -7.45, 0],
    [-11.5, -5.15, Math.PI],
    [-10.5, -5.15, Math.PI],
    [-9.5, -5.15, Math.PI],
  ];
  {
    box(3, 0.07, 1.2, '#f2efe8', -10.5, 0.74, -6.3);
    box(0.12, 0.7, 0.8, '#2a2d3a', -11.6, 0.36, -6.3);
    box(0.12, 0.7, 0.8, '#2a2d3a', -9.4, 0.36, -6.3);
    block(-12, -6.9, -9, -5.7);
    MEET.forEach(([x, z, r], i) => {
      chair(x, z, r, '#6b4a70');
      spot('meet-' + i, x, z, r, 'sit', 0.45);
      spot('night-m' + i, x, z, r, 'sleep', 0.45);
    });
    chair(-12.55, -6.3, Math.PI / 2, '#d9a521');
    spot('meet-boss', -12.55, -6.3, Math.PI / 2, 'sit', 0.45);
    [
      [-8.0, -3.3],
      [-8.9, -3.3],
      [-7.1, -3.3],
    ].forEach(([x, z], i) => spot('meet-s' + i, x, z, faceTo(x, z, -10.5, -6.3), 'stand'));
    box(2.6, 1.45, 0.06, '#1d2030', -10.5, 1.75, -9.92);
    const tvFace = new THREE.Mesh(
      new THREE.PlaneGeometry(2.45, 1.32),
      new THREE.MeshStandardMaterial({
        map: kanbanTex,
        emissive: '#ffffff',
        emissiveMap: kanbanTex,
        emissiveIntensity: 0.35,
      }),
    );
    tvFace.position.set(-10.5, 1.75, -9.885);
    scene.add(tvFace);
    plant(-14.3, -9.3);
    plant(-6.7, -9.3, 0.9);
  }

  /* cocina */
  {
    box(0.8, 0.88, 5.2, '#4c5d7a', 14.6, 0.44, 6.2);
    box(0.86, 0.05, 5.26, '#f2efe8', 14.6, 0.905, 6.2);
    block(14.2, 3.6, 15, 8.8, 0.3);
    box(0.45, 0.5, 0.42, '#2a2d3a', 14.6, 1.18, 4.7);
    box(0.3, 0.05, 0.3, '#9aa0b5', 14.48, 0.95, 4.7);
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 8, 8),
      new THREE.MeshStandardMaterial({ color: '#46c37b', emissive: '#46c37b', emissiveIntensity: 2 }),
    );
    led.position.set(14.37, 1.3, 4.7);
    scene.add(led);
    cyl(0.06, 0.06, 0.25, '#c8352e', 14.6, 1.05, 5.6, scene, 12);
    cyl(0.12, 0.12, 0.05, '#efece4', 14.6, 0.95, 7.2, scene, 20);
    box(0.85, 2, 0.8, '#dfe6ee', 14.55, 1, 9.4);
    box(0.04, 0.6, 0.04, '#9aa0b5', 14.1, 1.2, 9.2);
    block(14.1, 9, 15, 10);
    cyl(0.65, 0.65, 0.05, '#f2efe8', 11.5, 0.76, 6.8, scene, 32);
    cyl(0.07, 0.07, 0.72, '#2a2d3a', 11.5, 0.38, 6.8, scene, 12);
    cyl(0.32, 0.32, 0.03, '#2a2d3a', 11.5, 0.02, 6.8, scene, 20);
    block(10.85, 6.15, 12.15, 7.45, 0.3);
    [
      [12.6, 6.8],
      [10.4, 6.8],
      [11.5, 7.9],
      [11.5, 5.7],
    ].forEach(([x, z], i) => {
      cyl(0.2, 0.2, 0.06, '#d9772b', x, 0.6, z, scene, 18);
      cyl(0.03, 0.03, 0.58, '#2a2d3a', x, 0.3, z, scene, 8);
      cyl(0.18, 0.18, 0.02, '#2a2d3a', x, 0.01, z, scene, 16);
      spot('lunch-' + i, x, z, faceTo(x, z, 11.5, 6.8), 'sit', 0.63);
    });
    [
      [12.9, 8.3],
      [10.1, 8.3],
      [10.1, 5.3],
    ].forEach(([x, z], i) => spot('lunch-s' + i, x, z, faceTo(x, z, 11.5, 6.8), 'stand'));
    [4.0, 5.4, 6.8].forEach((z, i) => spot('coffee-' + i, 13.55, z, Math.PI / 2, 'stand'));
    plant(9.2, 9.3);
    floorLamp(6.3, 8.9);
  }

  /* zona chill */
  {
    box(0.9, 0.45, 4.4, '#7c4a7e', -14.45, 0.225, 6.8);
    box(0.28, 0.9, 4.4, '#6a3e6c', -14.82, 0.45, 6.8);
    box(0.9, 0.62, 0.25, '#6a3e6c', -14.45, 0.31, 4.55);
    box(0.9, 0.62, 0.25, '#6a3e6c', -14.45, 0.31, 9.05);
    block(-15, 4.4, -14.0, 9.2, 0.25);
    [5.3, 6.3, 7.3, 8.3].forEach((z, i) => spot('chill-' + i, -13.6, z, Math.PI / 2, 'sleep', 0.45));
    box(0.7, 0.36, 1.6, '#4a2f1c', -12.3, 0.18, 6.8);
    block(-12.65, 6, -11.95, 7.6, 0.25);
    [
      [-10.9, 5.9],
      [-10.9, 7.7],
    ].forEach(([x, z], i) => {
      const bag = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), mat(i ? '#ffb547' : '#38d3e0'));
      bag.scale.set(1, 0.6, 1);
      bag.position.set(x + 0.25, 0.28, z);
      bag.castShadow = true;
      scene.add(bag);
      spot('chill-' + (4 + i), x, z, -Math.PI / 2, 'sleep', 0.38);
    });
    floorLamp(-14.4, 9.6);
    plant(-9.8, 9.3);
  }

  roomLight(10.6, -5);
  roomLight(-10.5, -6.3);
  roomLight(-5, 2.6);
  roomLight(0, 2.6);
  roomLight(-3, 7);
  roomLight(11.8, 6.6);
  roomLight(-12.4, 6.8, 2.6);
  buildGrid();

  /* =====================================================================
     3. HÉROE 3D — mira hacia +z; ojos y boca van dentro del grupo cabeza
     ===================================================================== */
  const S = 0.92;
  function makeHero(def) {
    const L = def.look;
    const M = (c, o) => mat(c, o);
    const mesh = (geo, m, parent, x = 0, y = 0, z = 0) => {
      const o = new THREE.Mesh(geo, m);
      o.position.set(x, y, z);
      o.castShadow = true;
      parent.add(o);
      return o;
    };
    const root = new THREE.Group();
    const body = new THREE.Group();
    body.scale.setScalar(S);
    root.add(body);
    const parts = { body };

    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0.11 * s, 0.9, 0);
      body.add(hip);
      mesh(new THREE.CapsuleGeometry(0.085, 0.26, 4, 12), M(L.suit2), hip, 0, -0.2, 0);
      const knee = new THREE.Group();
      knee.position.y = -0.42;
      hip.add(knee);
      mesh(new THREE.CapsuleGeometry(0.08, 0.24, 4, 12), M(L.suit2), knee, 0, -0.19, 0);
      mesh(new THREE.BoxGeometry(0.17, 0.11, 0.27), M(L.boot), knee, 0, -0.425, 0.045);
      parts[s < 0 ? 'hipL' : 'hipR'] = hip;
      parts[s < 0 ? 'kneeL' : 'kneeR'] = knee;
    }
    const pelvis = mesh(new THREE.CapsuleGeometry(0.16, 0.13, 4, 12), M(L.suit2), body, 0, 0.93, 0);
    pelvis.rotation.z = Math.PI / 2;
    mesh(new THREE.CapsuleGeometry(0.21, 0.32, 6, 20), M(L.suit), body, 0, 1.27, 0);
    mesh(new THREE.CylinderGeometry(0.215, 0.215, 0.06, 24), M(L.suit2), body, 0, 1.0, 0);
    mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.14, 12), M(L.skin), body, 0, 1.71, 0);

    /* emblema en el pecho, pegado a la superficie del torso (radio 0.21) */
    const sides = { sun: 24, hex: 6, square: 4, tri: 3, ring: 24, shield: 5, diamond: 4 }[L.emblem] || 24;
    const emColor = L.emblem === 'ring' ? L.suit2 : L.suit2 === '#d9a521' ? '#d9a521' : '#f4f1e8';
    const emblem = mesh(
      new THREE.CylinderGeometry(0.075, 0.075, 0.02, sides),
      M(emColor, { metalness: 0.3, roughness: 0.4 }),
      body,
      0,
      1.33,
      0.212,
    );
    emblem.rotation.x = Math.PI / 2;
    if (L.emblem === 'diamond' || L.emblem === 'square') emblem.rotation.y = Math.PI / 4;
    if (L.emblem === 'ring') {
      const hole = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.022, 20), M(L.suit), body, 0, 1.33, 0.214);
      hole.rotation.x = Math.PI / 2;
    }
    if (L.emblem === 'sun')
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const ray = mesh(
          new THREE.BoxGeometry(0.018, 0.04, 0.012),
          M('#d9a521'),
          body,
          Math.cos(a) * 0.105,
          1.33 + Math.sin(a) * 0.105,
          0.208,
        );
        ray.rotation.z = a - Math.PI / 2;
      }
    if (L.tie) {
      const sh = new THREE.Shape();
      sh.moveTo(-0.022, 0);
      sh.lineTo(0.022, 0);
      sh.lineTo(0.042, -0.2);
      sh.lineTo(0, -0.245);
      sh.lineTo(-0.042, -0.2);
      sh.closePath();
      mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.014, bevelEnabled: false }), M(L.tie), body, 0, 1.445, 0.208);
      mesh(new THREE.BoxGeometry(0.05, 0.042, 0.03), M(darken(L.tie, 0.75)), body, 0, 1.465, 0.2);
      emblem.visible = false;
    }
    if (L.cape) {
      const cape = mesh(
        new THREE.BoxGeometry(0.44, 1.08, 0.025),
        M(L.cape, { side: THREE.DoubleSide }),
        body,
        0,
        1.08,
        -0.245,
      );
      cape.rotation.x = 0.1;
      mesh(new THREE.BoxGeometry(0.52, 0.06, 0.12), M(L.cape), body, 0, 1.62, -0.18);
    }
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(0.29 * s, 1.55, 0);
      body.add(sh);
      mesh(new THREE.SphereGeometry(0.09, 16, 12), M(L.suit), sh);
      mesh(new THREE.CapsuleGeometry(0.072, 0.24, 4, 12), M(L.suit), sh, 0, -0.17, 0);
      const el = new THREE.Group();
      el.position.y = -0.36;
      sh.add(el);
      mesh(new THREE.CapsuleGeometry(0.066, 0.22, 4, 12), M(L.gauntlets || L.suit), el, 0, -0.15, 0);
      if (L.gauntlets)
        mesh(
          new THREE.BoxGeometry(0.17, 0.17, 0.17),
          M(L.gauntlets, { metalness: 0.5, roughness: 0.4 }),
          el,
          0,
          -0.34,
          0,
        );
      else mesh(new THREE.SphereGeometry(0.075, 16, 12), M(L.skin), el, 0, -0.33, 0);
      parts[s < 0 ? 'shL' : 'shR'] = sh;
      parts[s < 0 ? 'elL' : 'elR'] = el;
    }
    if (L.gauntlets)
      for (const s of [-1, 1])
        mesh(
          new THREE.BoxGeometry(0.2, 0.08, 0.22),
          M(L.gauntlets, { metalness: 0.5, roughness: 0.4 }),
          body,
          0.29 * s,
          1.66,
          0,
        );

    /* cabeza: esfera de radio 0.2 con centro en y = 1.95 */
    const head = new THREE.Group();
    head.position.y = 1.95;
    body.add(head);
    parts.head = head;
    mesh(new THREE.SphereGeometry(0.2, 32, 24), M(L.skin), head);
    for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.045, 12, 10), M(L.skin), head, 0.198 * s, -0.01, -0.01);
    if (L.mask) {
      const band = mesh(
        new THREE.SphereGeometry(0.204, 40, 8, Math.PI / 2 - 1.15, 2.3, 1.2, 0.42),
        M(L.mask, { side: THREE.DoubleSide }),
        head,
      );
      band.castShadow = false;
    }
    /* ojos: esclerótica aplanada que asoma de la superficie + pupila delante + brillo */
    const eyes = new THREE.Group();
    eyes.position.y = 0.035;
    head.add(eyes);
    parts.eyes = eyes;
    for (const s of [-1, 1]) {
      const sc = mesh(
        new THREE.SphereGeometry(0.042, 20, 14),
        M('#ffffff', { roughness: 0.3 }),
        eyes,
        0.072 * s,
        0,
        0.17,
      );
      sc.scale.z = 0.7;
      sc.castShadow = false;
      mesh(
        new THREE.SphereGeometry(0.024, 16, 12),
        M('#1b1d2a', { roughness: 0.2 }),
        eyes,
        0.072 * s,
        0,
        0.195,
      ).castShadow = false;
      mesh(
        new THREE.SphereGeometry(0.007, 8, 6),
        new THREE.MeshBasicMaterial({ color: '#ffffff' }),
        eyes,
        0.072 * s + 0.008,
        0.009,
        0.217,
      ).castShadow = false;
    }
    /* boca: arco de toro inclinado para seguir la curva de la cara */
    const mouthG = new THREE.Group();
    mouthG.position.set(0, -0.06, 0.181);
    head.add(mouthG);
    const mouth = mesh(new THREE.TorusGeometry(0.042, 0.009, 6, 18, Math.PI), M('#5a2a2a'), mouthG);
    mouth.rotation.set(0.27, 0, Math.PI);
    mouth.castShadow = false;
    if (L.helmet) {
      mesh(
        new THREE.SphereGeometry(0.222, 32, 16, 0, Math.PI * 2, 0, 1.5),
        M(L.helmet, { metalness: 0.6, roughness: 0.35 }),
        head,
      );
      const visor = mesh(
        new THREE.CylinderGeometry(0.236, 0.236, 0.085, 32, 1, true, -1.05, 2.1),
        new THREE.MeshStandardMaterial({
          color: L.visor,
          emissive: L.visor,
          emissiveIntensity: 0.9,
          side: THREE.DoubleSide,
          roughness: 0.2,
        }),
        head,
        0,
        0.035,
        0,
      );
      visor.castShadow = false;
      mesh(
        new THREE.BoxGeometry(0.04, 0.1, 0.2),
        M(L.helmet, { metalness: 0.6, roughness: 0.35 }),
        head,
        0,
        0.22,
        -0.02,
      );
    } else {
      mesh(new THREE.SphereGeometry(0.215, 32, 16, 0, Math.PI * 2, 0, 1.15), M(L.hair), head, 0, 0.004, -0.008);
      if (L.longHair)
        mesh(new THREE.SphereGeometry(0.218, 32, 16, Math.PI, Math.PI, 0, 2.05), M(L.hair), head, 0, 0, -0.01);
    }
    if (L.monocle) {
      mesh(
        new THREE.TorusGeometry(0.052, 0.01, 8, 24),
        M('#d9a521', { metalness: 0.8, roughness: 0.3 }),
        eyes,
        0.072,
        0,
        0.214,
      ).castShadow = false;
      mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.16, 6), M('#d9a521'), head, 0.135, -0.07, 0.17).rotation.z = 0.5;
    }
    if (L.headphones) {
      mesh(new THREE.TorusGeometry(0.228, 0.018, 8, 32, Math.PI), M('#f2f2f2'), head);
      for (const s of [-1, 1])
        mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.06, 20), M('#f2f2f2'), head, 0.222 * s, 0, 0).rotation.z =
          Math.PI / 2;
    }
    if (L.antenna) {
      mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 8), M('#2a2d3a'), head, 0.06, 0.29, 0);
      parts.bulb = mesh(
        new THREE.SphereGeometry(0.03, 12, 10),
        new THREE.MeshStandardMaterial({ color: '#c8ff7a', emissive: L.accent || '#a6e05a', emissiveIntensity: 1.5 }),
        head,
        0.06,
        0.4,
        0,
      );
    }
    root.traverse((o) => {
      o.userData.heroId = def.id;
    });
    return { root, parts };
  }

  /* =====================================================================
     4. AGENTES: HORARIO, RUTAS Y ANIMACIÓN
     ===================================================================== */
  const agents = HEROES.map((def, idx) => {
    const { root, parts } = makeHero(def);
    scene.add(root);
    return {
      def,
      id: def.id,
      idx: idx - 1,
      root,
      parts,
      path: [],
      target: null,
      arrived: false,
      ry: 0,
      phase: Math.random() * 6,
      job: null,
      step: 0,
      stepT: 0,
      bubble: '',
      bubbleT: 0,
      coffee: 0,
      coffeeSpot: null,
      supervise: 0,
      blinkT: rnd(1, 4),
      lastEvent: 0,
      tok: { in: 0, out: 0, chat: 0 },
    };
  });
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
  const byAgent = Object.fromEntries(agents.filter((a) => !a.def.boss).map((a) => [a.def.agent, a]));
  const boss = byId.boss;
  const STAGES = stageNames.map((s) => s.map((n) => byAgent[n]).filter(Boolean)).filter((s) => s.length);

  let hour = 8.4,
    day = 1,
    speedMode = 'fast',
    paused = false,
    live = false;
  const SPEED = { real: 0, fast: 1 / 15, turbo: 1 / 5 };
  const isNight = (h) => h >= 22.5 || h < 7;
  const isStandup = (h) => h >= 9.5 && h < 10.25;
  const isLunch = (h) => h >= 13.5 && h < 14.5;
  const workHours = (h) => h >= 8 && h < 21.5 && !isStandup(h);

  function scheduleSpot(a) {
    const i = a.idx;
    if (isNight(hour)) return a.def.boss ? SPOTS['night-boss'] : SPOTS[i < 6 ? 'chill-' + i : 'night-m' + (i - 6)];
    if (isStandup(hour)) return a.def.boss ? SPOTS['meet-boss'] : SPOTS[i < 6 ? 'meet-' + i : 'meet-s' + (i - 6)];
    if (isLunch(hour))
      return a.def.boss
        ? SPOTS['coffee-2']
        : SPOTS[i < 4 ? 'lunch-' + i : i < 6 ? 'coffee-' + (i - 4) : 'lunch-s' + (i - 6)];
    return null;
  }
  function desiredSpot(a) {
    const own = SPOTS['desk-' + a.id];
    if (a.job || (a.def.boss && issueState === 'opening')) return own;
    const sch = scheduleSpot(a);
    if (sch) return sch;
    if (a.supervise > 0) return SPOTS.board;
    if (a.coffee > 0 && a.coffeeSpot) return a.coffeeSpot;
    return own;
  }
  function setTarget(a, s) {
    a.target = s;
    a.arrived = false;
    const p = findPath(a.root.position.x, a.root.position.z, s.x, s.z);
    a.path = p || [[s.x, s.z]];
  }
  const say = (a, text, secs = 3.5) => {
    a.bubble = text;
    a.bubbleT = secs;
  };
  const placeName = (s) =>
    !s
      ? 'algún sitio'
      : s.id.startsWith('desk')
        ? 'su mesa'
        : s.id.startsWith('meet')
          ? 'la sala de reuniones'
          : s.id.startsWith('lunch') || s.id.startsWith('coffee')
            ? 'la cocina'
            : s.id === 'board'
              ? 'el tablero'
              : 'la zona chill';
  function activity(a) {
    if (!a.arrived)
      return { k: 'camina', t: a.job ? 'Vuelve corriendo a su mesa' : 'De camino a ' + placeName(a.target) };
    const id = a.target.id;
    if (id.startsWith('desk'))
      return a.job
        ? { k: 'trabaja', t: a.job.steps[a.step] || 'Trabajando' }
        : { k: 'libre', t: a.def.boss ? 'En su despacho' : 'En su mesa, sin tarea' };
    if (a.target.pose === 'sleep') return { k: 'duerme', t: 'Durmiendo' };
    if (id.startsWith('meet')) return { k: 'reunion', t: 'Daily en la sala de reuniones' };
    if (id.startsWith('lunch')) return { k: 'come', t: 'Comiendo en la cocina' };
    if (id.startsWith('coffee'))
      return { k: 'cafe', t: isLunch(hour) ? 'Comiendo de pie en la cocina' : 'Tomando café' };
    return { k: 'libre', t: 'Revisando el tablero' };
  }
  const frases = (a, k) =>
    (a.def.frases && a.def.frases[k]) ||
    (k === 'daily' ? ['Ayer avancé bien', 'Hoy sigo con lo mío'] : ['Listo para lo que venga', 'Repasando mis reglas']);

  const damp = (cur, tgt, k) => cur + (tgt - cur) * k;
  function angleLerp(a, b, k) {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * k;
  }
  function updateAgent(a, dt) {
    a.phase += dt;
    a.bubbleT -= dt;
    a.blinkT -= dt;
    const want = desiredSpot(a);
    if (want !== a.target) setTarget(a, want);

    let moving = false;
    if (!a.arrived) {
      const n = a.path[0];
      if (!n) {
        a.arrived = true;
        a.root.position.set(a.target.x, 0, a.target.z);
        onArrive(a);
      } else {
        const dx = n[0] - a.root.position.x,
          dz = n[1] - a.root.position.z,
          d = Math.hypot(dx, dz),
          st = 2.3 * dt;
        if (d <= st) {
          a.root.position.x = n[0];
          a.root.position.z = n[1];
          a.path.shift();
        } else {
          a.root.position.x += (dx / d) * st;
          a.root.position.z += (dz / d) * st;
        }
        if (d > 0.01) a.ry = angleLerp(a.ry, Math.atan2(dx, dz), 1 - Math.exp(-10 * dt));
        moving = true;
      }
    } else a.ry = angleLerp(a.ry, a.target.ry, 1 - Math.exp(-8 * dt));
    a.root.rotation.y = a.ry;

    const atDesk = a.arrived && a.target.id === 'desk-' + a.id;
    if (a.job && atDesk && !a.job.live) {
      a.stepT -= dt;
      if (a.stepT <= 0) {
        addTokens(a, a.step === 0);
        a.step++;
        if (a.step >= a.job.steps.length) finishJob(a);
        else {
          a.stepT = rnd(2.4, 3.6);
          say(a, a.job.steps[a.step], a.stepT + 0.3);
        }
      } else if (a.bubbleT <= 0 && a.job.steps[a.step]) say(a, a.job.steps[a.step], a.stepT + 0.2);
    }
    if (a.job && a.job.live && performance.now() - a.lastEvent > 300000) {
      a.job = null;
    }

    if (
      a.arrived &&
      !a.job &&
      a.target.id === 'desk-' + a.id &&
      workHours(hour) &&
      !isLunch(hour) &&
      Math.random() < dt * (a.def.boss ? 0.02 : 0.035)
    ) {
      if (a.def.boss) a.supervise = rnd(6, 9);
      else {
        const free = [0, 1, 2].map((i) => SPOTS['coffee-' + i]).find((s) => !agents.some((o) => o.coffeeSpot === s));
        if (free) {
          a.coffeeSpot = free;
          a.coffee = rnd(6, 10);
          say(a, pick(['Voy a por café ☕', 'Pausa de dos minutos', 'Necesito cafeína']), 2.5);
        }
      }
    }
    if (a.arrived && a.target === a.coffeeSpot) {
      a.coffee -= dt;
      if (a.coffee <= 0) a.coffeeSpot = null;
    }
    if (a.arrived && a.target.id === 'board') {
      a.supervise -= dt;
      if (a.supervise > 0 && a.bubbleT <= 0 && Math.random() < dt * 0.5)
        say(a, issue ? `#${issue.n} va bien encaminada` : 'Tablero al día', 2.5);
    }
    if (a.job) {
      a.coffee = 0;
      a.coffeeSpot = null;
      a.supervise = 0;
    }
    if (a.arrived && !a.job && !scheduleSpot(a) && a.bubbleT <= -6 && Math.random() < dt * 0.04)
      say(a, pick(frases(a, 'libre')), 2.6);
    if (
      a.arrived &&
      a.target.id.startsWith('meet') &&
      a.target.pose !== 'sleep' &&
      a.bubbleT <= -1 &&
      Math.random() < dt * 0.25
    )
      say(a, pick(frases(a, 'daily')), 3);
    if (a.arrived && a.target.pose === 'sleep' && a.bubbleT <= 0) say(a, 'Zz…', 3);

    /* pose */
    const act = a.arrived ? a.target.pose : 'walk';
    const P = { hip: 0, knee: 0, shL: 0.05, shR: 0.05, el: 0, bodyY: 0, bodyZ: 0, head: 0 };
    const typing = a.job && atDesk;
    if (act === 'sit' || act === 'sleep') {
      P.hip = -Math.PI / 2;
      P.knee = Math.PI / 2;
      P.bodyY = a.target.seatH + 0.075 - 0.9 * S;
      P.bodyZ = -0.15;
      P.shL = P.shR = typing ? -0.95 : -0.45;
      P.el = typing ? -0.75 : -0.65;
      if (act === 'sleep') {
        P.head = 0.38;
        P.shL = P.shR = -0.35;
        P.el = -0.7;
      }
    } else if (act === 'stand') {
      const cup = a.target.id.startsWith('coffee');
      P.shL = 0.08;
      P.shR = cup ? -0.6 : 0.08;
      P.el = cup ? -1.1 : 0;
    }
    const k = 1 - Math.exp(-10 * dt),
      p = a.parts;
    if (moving) {
      a.phase += dt * 5;
      const s = Math.sin(a.phase * 2.2);
      p.hipL.rotation.x = s * 0.55;
      p.hipR.rotation.x = -s * 0.55;
      p.kneeL.rotation.x = Math.max(0, s) * 0.8;
      p.kneeR.rotation.x = Math.max(0, -s) * 0.8;
      p.shL.rotation.x = -s * 0.5;
      p.shR.rotation.x = s * 0.5;
      p.elL.rotation.x = -0.25;
      p.elR.rotation.x = -0.25;
      p.body.position.y = Math.abs(Math.cos(a.phase * 2.2)) * 0.04;
      p.body.position.z = 0;
      p.head.rotation.x = 0;
    } else {
      const osc = typing ? Math.sin(a.phase * 18) * 0.06 : 0;
      p.hipL.rotation.x = damp(p.hipL.rotation.x, P.hip, k);
      p.hipR.rotation.x = damp(p.hipR.rotation.x, P.hip, k);
      p.kneeL.rotation.x = damp(p.kneeL.rotation.x, P.knee, k);
      p.kneeR.rotation.x = damp(p.kneeR.rotation.x, P.knee, k);
      p.shL.rotation.x = damp(p.shL.rotation.x, P.shL + osc, k);
      p.shR.rotation.x = damp(p.shR.rotation.x, P.shR - osc, k);
      p.elL.rotation.x = damp(p.elL.rotation.x, P.el, k);
      p.elR.rotation.x = damp(p.elR.rotation.x, P.el, k);
      p.body.position.y = damp(p.body.position.y, P.bodyY + (act === 'stand' ? Math.sin(a.phase * 1.6) * 0.006 : 0), k);
      p.body.position.z = damp(p.body.position.z, P.bodyZ, k);
      p.head.rotation.x = damp(p.head.rotation.x, P.head + (act === 'sleep' ? Math.sin(a.phase * 0.8) * 0.04 : 0), k);
    }
    let ey = 1;
    if (a.arrived && act === 'sleep') ey = 0.12;
    else if (a.blinkT < 0) {
      ey = 0.12;
      if (a.blinkT < -0.12) a.blinkT = rnd(2, 5);
    }
    p.eyes.scale.y = damp(p.eyes.scale.y, ey, 0.6);
    if (p.bulb) p.bulb.material.emissiveIntensity = 0.8 + Math.max(0, Math.sin(a.phase * 4)) * 1.6;
    const scr = screens[a.id];
    if (scr) {
      const on = a.job && atDesk;
      scr.material.emissive.set(on ? COLOR[a.id] : a.def.boss && !isNight(hour) ? '#2a3150' : '#0c1020');
      scr.material.emissiveIntensity = on ? 0.55 + Math.sin(a.phase * 7) * 0.08 : 0.6;
    }
  }
  function onArrive(a) {
    if (a.target.id.startsWith('meet') && isStandup(hour)) say(a, pick(frases(a, 'daily')), 3);
    if (a.target.id.startsWith('lunch') || (a.target.id.startsWith('coffee') && isLunch(hour)))
      say(a, pick(['¡A comer! 🍝', 'Qué hambre', 'Hoy toca táper']), 2.5);
    if (a.job && a.target.id === 'desk-' + a.id) say(a, a.job.steps[a.step], a.job.live ? 6 : a.stepT + 0.3);
  }

  /* =====================================================================
     5. SIMULACIÓN DE ISSUES
     ===================================================================== */
  let issue = null,
    issueIdx = 0,
    issueState = 'idle',
    issueT = 6,
    prCount = 0,
    ciCreated = false;
  const planes = [];
  function stepsFor(a, is) {
    const r = is.res,
      id = '#' + is.n;
    switch (a.def.agent) {
      case 'analista':
        return [
          `Read · issue ${id}`,
          `Grep · rutas de /${r}`,
          'Read · validador → servicio',
          '¿Choca con /:id?',
          'Plan listo: 4 archivos',
        ];
      case 'back':
        return [
          `Edit · routes/${r}.routes.js`,
          `Write · validators/${r}.js`,
          `Edit · controllers/${r}.js`,
          `Edit · services/${r}.service.js`,
          '@openapi añadida ✔',
        ];
      case 'front':
        return ['Read · pedir()', `Edit · js/${r}.js`, `Edit · ${r}.html`, 'Mismo estilo visual ✔'];
      case 'qa': {
        const fail = Math.random() < 0.35,
          n = 10 + (is.n % 7);
        return [
          `Write · tests/${r}.test.js`,
          'Caso bueno + caso 400',
          'Bash · npm test',
          ...(fail ? ['✖ 1 test falla', 'Edit · corrigiendo validador', 'Bash · npm test'] : []),
          `✔ ${n}/${n} tests`,
        ];
      }
      case 'seguridad':
        return [
          'Grep · autenticar/autorizar',
          'Revisando IDOR en /:id',
          'Grep · secretos en el código',
          ...(!ciCreated ? ['Write · .github/workflows/test.yml'] : []),
          'Informe: sin riesgos graves',
        ];
      case 'revisor':
        return ['Bash · git diff main', 'Leyendo el diff…', 'Veredicto…'];
    }
    const tools = a.def.tools.length ? a.def.tools : ['Read'];
    const base = (
      a.def.rules.length ? a.def.rules : ['Leyendo instrucciones', 'Trabajando en ' + id, 'Revisando resultado']
    ).slice(0, 4);
    return base.map((s, i) => `${tools[i % tools.length]} · ${s.length > 30 ? s.slice(0, 29) + '…' : s}`);
  }
  function addTokens(a, big) {
    const opus = /opus/i.test(a.def.model);
    a.tok.in += Math.round(rnd(opus ? 2500 : 1200, opus ? 6500 : 3800) * (big ? 1.4 : 1));
    a.tok.out += Math.round(rnd(opus ? 400 : 250, opus ? 1300 : 900));
  }
  function openIssue() {
    const list =
      CFG.issues && CFG.issues.length
        ? CFG.issues
        : [{ n: 1, title: 'Issue de ejemplo', res: 'recurso', route: 'GET /recurso' }];
    const base = list[issueIdx % list.length];
    const n = base.n + Math.floor(issueIdx / list.length) * list.length;
    issueIdx++;
    issue = { ...base, n, stage: -1, pending: new Set(), bounced: false };
    issueState = 'opening';
    issueT = 0;
    log(null, `Nueva issue <b>#${n}</b>: ${esc(base.title)}`);
    drawKanban();
    renderIssue();
  }
  function startStage(from, k) {
    issue.stage = k;
    issue.pending = new Set(STAGES[k]);
    STAGES[k].forEach((t) => flyPlane(from, t, '#' + issue.n));
    drawKanban();
    renderIssue();
  }
  function flyPlane(from, to, label, live = false) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          0, 0, 0.22, -0.16, 0, -0.14, 0, 0.02, -0.08, 0, 0, 0.22, 0, 0.02, -0.08, 0.16, 0, -0.14, 0, 0, 0.22, 0, -0.07,
          -0.12, 0, 0.02, -0.08,
        ],
        3,
      ),
    );
    geo.computeVertexNormals();
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: '#fffdf7',
        side: THREE.DoubleSide,
        emissive: '#fff4d6',
        emissiveIntensity: 0.25,
      }),
    );
    m.castShadow = true;
    m.scale.setScalar(1.7);
    scene.add(m);
    planes.push({ m, from, to, label, live, k: 0 });
  }
  function headPos(a, out = new THREE.Vector3()) {
    a.parts.head.getWorldPosition(out);
    out.y += 0.35;
    return out;
  }
  function onPlaneArrive(p) {
    if (p.live) return;
    const t = p.to;
    if (p.label === 'PR') {
      prCount++;
      say(t, `¡Mergeada la #${issue.n}! Gran trabajo, equipo.`, 4.5);
      log(t, `aprueba y cierra la <b>#${issue.n}</b>. <span class="pr">PR mergeada</span>`);
      issue = null;
      issueState = 'idle';
      issueT = rnd(8, 14);
      drawKanban();
      renderIssue();
      return;
    }
    if (!issue) return;
    t.job = { issue, steps: stepsFor(t, issue) };
    t.step = 0;
    t.stepT = rnd(2.4, 3.6);
    say(t, '¡Recibido! ' + p.label, 2.5);
  }
  function finishJob(a) {
    const is = a.job.issue;
    a.job = null;
    if (a.def.agent === 'seguridad') ciCreated = true;
    if (!issue || issue !== is) return;
    issue.pending.delete(a);
    const isLast = issue.stage === STAGES.length - 1 && STAGES.length > 1 && !issue.redo;
    const fixer = STAGES.length > 2 ? STAGES[1][0] : null;
    if (isLast && issue.pending.size === 0) {
      if (fixer && !is.bounced && Math.random() < 0.15) {
        is.bounced = true;
        say(a, '✖ Hay que corregir algo', 3.5);
        log(
          a,
          `<span class="ko">no abre la PR</span>: hay un problema en ${esc(is.route)}. Vuelve a ${esc(fixer.def.name)}.`,
        );
        issue.redo = a;
        issue.pending = new Set([fixer]);
        flyPlane(a, fixer, '#' + is.n + ' ✖');
        return;
      }
      say(a, `✔ PR abierta: [#${is.n}] ${is.title}`, 4);
      log(a, `<span class="pr">abre la PR</span> [#${is.n}] ${esc(is.title)} · Closes #${is.n}`);
      issueState = 'pr';
      flyPlane(a, boss, 'PR');
      drawKanban();
      renderIssue();
      return;
    }
    say(a, '¡Hecho! ✔', 2.5);
    log(a, `termina su parte de <b>#${is.n}</b>.`);
    if (issue.pending.size) return;
    if (issue.redo) {
      const rv = issue.redo;
      issue.redo = null;
      issue.pending = new Set([rv]);
      flyPlane(a, rv, '#' + is.n);
      return;
    }
    if (issue.stage + 1 < STAGES.length) startStage(a, issue.stage + 1);
    else {
      issueState = 'pr';
      flyPlane(a, boss, 'PR');
    }
  }
  function updatePipeline(dt) {
    if (!live && STAGES.length) {
      if (issueState === 'idle') {
        if (workHours(hour) && !isLunch(hour)) {
          issueT -= dt;
          if (issueT <= 0) openIssue();
        }
      } else if (issueState === 'opening' && boss.arrived && boss.target.id === 'desk-boss') {
        const before = issueT;
        issueT += dt;
        if (before <= 0.05 && issueT > 0.05) {
          say(
            boss,
            `Nueva issue #${issue.n}: ${issue.title}. ${STAGES[0].map((x) => x.def.name).join(' y ')}, os toca.`,
            3.5,
          );
          addTokens(boss);
        }
        if (issueT > 2.2) {
          issueState = 'running';
          startStage(boss, 0);
        }
      }
    }
    planes.forEach((p) => {
      p.k += dt / 1.8;
      const a = headPos(p.from),
        b = headPos(p.to);
      const k = Math.min(1, p.k),
        pos = a.clone().lerp(b, k);
      pos.y += Math.sin(k * Math.PI) * 3;
      const k2 = Math.min(1, k + 0.02),
        ahead = a.clone().lerp(b, k2);
      ahead.y += Math.sin(k2 * Math.PI) * 3;
      p.m.position.copy(pos);
      if (k < 1) p.m.lookAt(ahead);
      if (p.k >= 1 && !p.done) {
        p.done = true;
        scene.remove(p.m);
        p.m.geometry.dispose();
        onPlaneArrive(p);
      }
    });
    for (let i = planes.length - 1; i >= 0; i--) if (planes[i].done) planes.splice(i, 1);
  }

  /* =====================================================================
     6. MODO EN DIRECTO — eventos de los hooks de Claude Code
     ===================================================================== */
  /* Con el servidor conectado la simulación sigue hasta que llega el primer evento real.
     Tras 10 minutos sin eventos, la oficina vuelve a simular. */
  const LIVE_IDLE_MS = 10 * 60 * 1000;
  let liveTok = { boss: 0 },
    liveAgentTok = {},
    connected = false,
    lastLiveEvent = 0;
  function setBadge() {
    $('#live').textContent = live ? '● En directo' : connected ? '● Conectada · simulando' : 'Simulación';
    $('#live').classList.toggle('on', live);
  }
  function enterLive() {
    live = true;
    liveTok = { boss: 0 };
    liveAgentTok = {};
    issue = null;
    issueState = 'idle';
    agents.forEach((a) => {
      if (a.job && !a.job.live) a.job = null;
    });
    planes.forEach((p) => (p.live = true));
    setSpeed('real', true);
    setBadge();
    log(null, 'Llegan eventos de Claude Code: la oficina muestra lo que hacen tus agentes de verdad.');
    drawKanban();
    renderIssue();
  }
  function exitLive(reason) {
    live = false;
    agents.forEach((a) => {
      a.liveN = 0;
      if (a.job && a.job.live) a.job = null;
    });
    issueT = 4;
    setBadge();
    log(null, reason);
    drawKanban();
    renderIssue();
  }
  function startLive() {
    if (!server || typeof EventSource === 'undefined') return;
    const es = new EventSource('api/eventos');
    es.addEventListener('hola', () => {
      if (!connected) log(null, 'Conectada al servidor. En cuanto uses Claude Code, la oficina pasará a directo.');
      connected = true;
      setBadge();
    });
    es.addEventListener('evento', (m) => {
      try {
        const ev = JSON.parse(m.data);
        if (!live) enterLive();
        lastLiveEvent = performance.now();
        onLiveEvent(ev);
      } catch (e) {
        console.error(e);
      }
    });
    es.onerror = () => {
      connected = false;
      // EventSource reconecta solo: solo se sale de directo si la conexión se cerró de verdad
      if (live && es.readyState === EventSource.CLOSED)
        exitLive('Se perdió la conexión con el servidor; vuelvo a la simulación.');
      else setBadge();
    };
  }
  function checkLiveIdle() {
    if (live && performance.now() - lastLiveEvent > LIVE_IDLE_MS)
      exitLive('Diez minutos sin actividad de Claude Code: la oficina vuelve a simular.');
  }
  function liveWork(a, text) {
    a.lastEvent = performance.now();
    if (!a.job || !a.job.live) {
      a.job = { live: true, steps: [text] };
      a.step = 0;
    } else a.job.steps[0] = text;
    say(a, text, 8);
  }
  function onLiveEvent(ev) {
    const who = ev.agente && Object.hasOwn(byAgent, ev.agente) ? byAgent[ev.agente] : null;
    switch (ev.tipo) {
      case 'inicio':
        say(boss, 'Sesión iniciada. ¡Escuadrón, en marcha!', 4);
        log(boss, 'abre una sesión de Claude Code.');
        break;
      case 'prompt':
        liveWork(boss, 'Encargo: ' + (ev.texto || '').slice(0, 80));
        log(boss, `recibe un encargo: ${esc((ev.texto || '').slice(0, 140))}`);
        break;
      case 'tarea':
        {
          const n = ev.agente || 'un agente';
          if (who) {
            who.liveN = (who.liveN || 0) + 1;
            flyPlane(boss, who, ev.agente, true);
            liveWork(who, ev.texto || 'Nueva tarea');
            log(boss, `→ <b style="color:${COLOR[who.id]}">${esc(who.def.name)}</b>: ${esc(ev.texto || '')}`);
          } else {
            liveWork(boss, `Lanzo a ${n}`);
            log(boss, `lanza a un agente que no está en la oficina: <b>${esc(n)}</b>`);
          }
        }
        break;
      case 'herramienta': {
        const a = who || boss;
        liveWork(a, `${ev.herramienta}${ev.detalle ? ' · ' + ev.detalle : ''}`);
        break;
      }
      case 'tarea_fin':
        if (who) {
          // Con varias tareas en paralelo, solo se libera al terminar la última
          who.liveN = Math.max(0, (who.liveN || 0) - 1);
          if (!who.liveN) who.job = null;
          say(who, '¡Hecho! ✔', 3);
          flyPlane(who, boss, 'ok', true);
          log(who, 'termina su tarea.');
        } else if (boss.job && boss.job.live) boss.job = null;
        break;
      case 'fin':
        boss.job = null;
        agents.forEach((a) => {
          a.liveN = 0;
          if (a.job && a.job.live) a.job = null;
        });
        say(boss, 'Listo. Turno terminado.', 4);
        log(boss, 'cierra el turno.');
        break;
      case 'tokens':
        liveTok[ev.sesion || 'x'] = (ev.entrada || 0) + (ev.salida || 0);
        boss.tok.in = Object.values(liveTok).reduce((s, n) => s + n, 0);
        boss.tok.out = 0;
        break;
      case 'tokens_agente':
        if (who) {
          liveAgentTok[ev.agente] = (liveAgentTok[ev.agente] || 0) + (ev.entrada || 0) + (ev.salida || 0);
          who.tok.in = liveAgentTok[ev.agente];
          who.tok.out = 0;
        }
        break;
    }
    drawKanban();
  }

  /* =====================================================================
     7. CICLO DÍA/NOCHE, KANBAN Y ETIQUETAS
     ===================================================================== */
  const SKY = [
    [0, '#0a0f26'],
    [5, '#141a42'],
    [6.3, '#f0956a'],
    [7.5, '#a9cff6'],
    [12, '#7db8ff'],
    [17.5, '#9ccbff'],
    [19.2, '#ff8a5c'],
    [20.4, '#3a2f6e'],
    [21.5, '#0f1434'],
    [24, '#0a0f26'],
  ].map(([h, c]) => [h, new THREE.Color(c)]);
  const skyCol = new THREE.Color(),
    tmpCol = new THREE.Color();
  function skyAt(h) {
    for (let i = 0; i < SKY.length - 1; i++)
      if (h >= SKY[i][0] && h <= SKY[i + 1][0])
        return skyCol.copy(SKY[i][1]).lerp(SKY[i + 1][1], (h - SKY[i][0]) / (SKY[i + 1][0] - SKY[i][0]));
    return skyCol.copy(SKY[0][1]);
  }
  function updateSky() {
    const sky = skyAt(hour);
    scene.background = sky;
    const ang = ((hour - 6) / 12) * Math.PI,
      elev = Math.sin(ang);
    sun.position.set(Math.cos(ang) * 28, Math.max(2, elev * 30), 14);
    const dayF = THREE.MathUtils.smoothstep(elev, -0.05, 0.3);
    sun.intensity = 1.9 * dayF;
    sun.color.setHSL(0.09, 0.6, 0.6 + 0.3 * dayF);
    moon.intensity = 0.32 * (1 - dayF);
    hemi.intensity = 0.25 + 0.45 * dayF;
    hemi.color.copy(tmpCol.set('#cfe0ff').lerp(sky, 0.3));
    ambient.intensity = 0.1 + 0.06 * (1 - dayF);
    const lampOn = 1 - THREE.MathUtils.smoothstep(elev, -0.1, 0.25);
    lamps.forEach((l) => {
      l.light.intensity = (l.bulb ? 1.6 : 2.4) * lampOn;
      if (l.bulb) {
        l.bulb.material.emissiveIntensity = 0.2 + 2.2 * lampOn;
        l.shade.material.emissiveIntensity = 0.9 * lampOn;
      }
    });
    winMat.color.copy(sky);
    winMat.emissive.copy(sky);
    winMat.emissiveIntensity = 0.35 + 0.4 * dayF;
    ground.material.color.set('#46553f').lerp(tmpCol.set('#121826'), 1 - dayF);
    if (renderer) renderer.toneMappingExposure = 0.95 + 0.15 * dayF;
  }
  function drawKanban() {
    const g = kanbanCanvas.getContext('2d'),
      W = 1024,
      H = 600;
    g.fillStyle = '#f7f5ef';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#161a2a';
    g.font = '800 44px "Bricolage Grotesque", sans-serif';
    g.fillText(live ? 'EN DIRECTO' : 'SPRINT', 40, 66);
    g.font = '500 26px "Figtree", sans-serif';
    g.fillStyle = '#5a5f78';
    g.fillText(
      live ? 'Eventos reales de Claude Code' : issue ? `#${issue.n} · ${issue.title}` : 'Sin issue abierta',
      live ? 330 : 230,
      64,
    );
    g.textAlign = 'right';
    g.fillText(live ? '' : `PRs: ${prCount}`, W - 40, 64);
    g.textAlign = 'left';
    const cw = (W - 80) / Math.max(1, STAGES.length);
    STAGES.forEach((st, i) => {
      const x = 40 + i * cw;
      g.fillStyle = '#e6e2d8';
      g.fillRect(x + 6, 100, cw - 12, H - 140);
      g.fillStyle = '#161a2a';
      g.font = `700 ${cw < 150 ? 17 : 22}px "Figtree", sans-serif`;
      g.fillText(st.map((a) => a.def.name).join(' + '), x + 18, 136, cw - 30);
      const working = st.some((a) => a.job);
      const done = !live && issue && (issue.stage > i || issueState === 'pr'),
        on = live ? working : issue && issue.stage === i && issueState === 'running';
      if (done || on) {
        g.fillStyle = on ? '#ffb547' : '#9fe0b6';
        g.fillRect(x + 22, 160, cw - 44, 110);
        g.fillStyle = '#161a2a';
        g.font = '800 30px "Bricolage Grotesque", sans-serif';
        g.fillText(live ? '●' : '#' + issue.n, x + 36, 205);
        g.font = '500 18px "Figtree", sans-serif';
        g.fillText(on ? 'en curso' : 'hecho ✔', x + 36, 245);
      }
    });
    kanbanTex.needsUpdate = true;
  }

  const labelsEl = $('#labels');
  agents.forEach((a) => {
    const el = document.createElement('div');
    el.className = 'tag';
    el.style.setProperty('--c', COLOR[a.id]);
    el.innerHTML = `<div class="bubble" hidden><b></b><span></span></div><div class="chip">${esc(a.def.name)} <i>· ${esc(a.def.agent)}</i></div>`;
    labelsEl.appendChild(el);
    a.el = el;
    a.bEl = el.querySelector('.bubble');
    a.bText = el.querySelector('.bubble span');
    el.querySelector('.bubble b').textContent = a.def.name;
  });
  const ROOMS = [
    ['Despacho del jefe', 10.5, 3.2, -9],
    ['Sala de reuniones', -10.5, 3.2, -9],
    ['Cocina', 12, 0.2, 9.4],
    ['Zona chill', -12.4, 0.2, 9.6],
    ['Zona de trabajo', -2.8, 0.2, 9.4],
  ].map(([t, x, y, z]) => {
    const el = document.createElement('div');
    el.className = 'roomtag';
    el.textContent = t;
    labelsEl.appendChild(el);
    return { el, v: new THREE.Vector3(x, y, z) };
  });
  const v3 = new THREE.Vector3();
  function placeLabels(w, h) {
    const put = (el, v) => {
      v3.copy(v).project(camera);
      if (v3.z > 1 || Math.abs(v3.x) > 1.2 || Math.abs(v3.y) > 1.2) {
        el.style.visibility = 'hidden';
        return;
      }
      el.style.visibility = 'visible';
      el.style.transform = `translate(${((v3.x + 1) / 2) * w}px, ${((1 - v3.y) / 2) * h}px) translate(-50%, -100%)`;
    };
    agents.forEach((a) => {
      const v = headPos(a);
      v.y += 0.05;
      const show = a.bubbleT > 0 || (a === selected && chatBusy);
      a.bEl.hidden = !show;
      if (show) a.bText.textContent = a.bubble.length > 120 ? a.bubble.slice(0, 118) + '…' : a.bubble;
      a.el.style.zIndex = a === selected ? 3 : show ? 2 : 1;
      put(a.el, v);
    });
    ROOMS.forEach((r) => put(r.el, r.v));
  }

  /* selección con clic y cámara que sigue al héroe elegido */
  let selected = boss,
    focusTarget = null,
    downXY = null;
  const ray = new THREE.Raycaster(),
    ndc = new THREE.Vector2();
  if (renderer) {
    renderer.domElement.addEventListener('pointerdown', (e) => {
      downXY = [e.clientX, e.clientY];
    });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!downXY || Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) > 6) return;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(
        agents.map((a) => a.root),
        true,
      )[0];
      if (hit) selectAgent(byId[hit.object.userData.heroId], true);
    });
  }
  function selectAgent(a, focus) {
    selected = a;
    if (focus && controls) focusTarget = new THREE.Vector3(a.root.position.x, 0.8, a.root.position.z);
    showTab('chat');
    renderWho();
    renderChat();
    renderTeam();
  }

  /* =====================================================================
     8. CHAT CON LOS HÉROES
     Orden: Claude dentro de claude.ai → API de Anthropic vía el servidor → offline
     ===================================================================== */
  let sample = null,
    chatBusy = false,
    chatCtl = null;
  const chats = store.get('ao-chats', {});
  HEROES.forEach((h) => {
    if (!Array.isArray(chats[h.agent])) chats[h.agent] = [];
  });
  let chatTok = store.get('ao-chattok', 0);
  if (window.claude && window.claude.use) {
    try {
      sample = await Promise.race([window.claude.use('sample'), new Promise((r) => setTimeout(() => r(null), 3000))]);
    } catch (e) {
      sample = null;
    }
  }
  const serverChat = !!(server && server.chat);

  function personaPrompt(a) {
    const d = a.def,
      act = activity(a);
    const team = HEROES.map((h) => `${h.name} (${h.agent})`).join(', ');
    const ctx = live
      ? 'La oficina está conectada en directo a Claude Code.'
      : issue
        ? `Issue en curso: #${issue.n} "${issue.title}".`
        : 'Ahora mismo no hay issue abierta.';
    return `Interpreta a ${d.name}, ${d.title}, un héroe original de "The Agent Office", una oficina donde cada héroe representa a un subagente de Claude Code.
Tu subagente es "${d.agent}" (modelo ${d.model}). Lo que hace: ${d.desc}
Sus reglas: ${d.rules.join('; ') || 'sin reglas escritas'}. Herramientas: ${d.tools.join(', ') || 'las de por defecto'}.
Personalidad: ${d.persona}.
Equipo: ${team}. ${boss.def.name} es el jefe y trabaja en su despacho aparte.
Situación (hora de la oficina ${clockText()}): ${act.t}. ${ctx}
Cómo responder: en español, en personaje, de 1 a 3 frases cortas, tono cercano y con humor ligero. Sin markdown ni listas. Si te preguntan por código real del repositorio, explica que desde la oficina no lo ves y que te lo pidan desde Claude Code.`;
  }
  function offlineReply(a) {
    const act = activity(a);
    return `${pick(frases(a, 'libre'))}. Ahora mismo: ${act.t.toLowerCase()}.`;
  }
  async function sendChat(text) {
    const a = selected,
      list = chats[a.def.agent];
    list.push({ role: 'user', content: text });
    const reply = { role: 'assistant', content: '' };
    list.push(reply);
    chatBusy = true;
    renderChat();
    say(a, '…', 30);
    const turns = list.slice(-13, -1);
    if (turns[0] && turns[0].role === 'assistant') turns.shift();
    const system = personaPrompt(a);
    let inTok = Math.round((system.length + turns.reduce((s, t) => s + t.content.length, 0)) / 4),
      outTok = 0;
    try {
      if (sample) {
        chatCtl = new AbortController();
        const res = await sample([{ role: 'user', content: system }, ...turns], {
          modelTier: 'quick',
          cache: false,
          signal: chatCtl.signal,
          onText: ({ text: t }) => {
            reply.content = t;
            say(a, t, 30);
            updateLastMsg(t);
          },
        });
        reply.content = res.text;
      } else if (serverChat) {
        chatCtl = new AbortController();
        const r = await fetch('api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ system, messages: turns }),
          signal: chatCtl.signal,
        });
        const j = await r.json();
        if (!r.ok) throw { code: 'server', message: j.error };
        reply.content = j.text;
        if (j.usage) {
          inTok = j.usage.input_tokens || inTok;
          outTok = j.usage.output_tokens || 0;
        }
      } else throw { code: 'offline' };
    } catch (e) {
      const code = e && e.code;
      if (code === 'not_granted') {
        sample = null;
        reply.note = 'Sin permiso para usar Claude: respondo en modo offline.';
      } else if (code === 'rate_limited') reply.note = 'Demasiados mensajes seguidos. Prueba en un rato.';
      else if (code === 'server')
        reply.note = `El servidor no pudo hablar con Claude: ${e.message || 'error desconocido'}.`;
      else if (code === 'offline')
        reply.note = 'Modo offline: añade ANTHROPIC_API_KEY al .env y arranca el servidor para hablar con Claude.';
      if (e && (e.name === 'AbortError' || code === 'cancelled')) reply.content = reply.content || '…';
      else reply.content = (e && e.text) || reply.content || offlineReply(a);
    }
    if (!outTok) outTok = Math.round(reply.content.length / 4);
    a.tok.chat += inTok + outTok;
    chatTok += inTok + outTok;
    say(a, reply.content, 7);
    chatBusy = false;
    chatCtl = null;
    store.set(
      'ao-chats',
      Object.fromEntries(
        Object.entries(chats).map(([k, v]) => [k, v.slice(-30).map(({ role, content }) => ({ role, content }))]),
      ),
    );
    store.set('ao-chattok', chatTok);
    renderChat();
    renderTeam();
  }

  /* =====================================================================
     9. PANEL, BARRA Y BUCLE PRINCIPAL
     ===================================================================== */
  function showTab(t) {
    document
      .querySelectorAll('.tabs button')
      .forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    document.querySelectorAll('.panel').forEach((p) => {
      p.hidden = p.dataset.panel !== t;
    });
  }
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  function renderWho() {
    $('#who').innerHTML = HEROES.map(
      (h) =>
        `<button type="button" class="av" style="--c:${COLOR[h.id]}" data-id="${h.id}" aria-pressed="${selected.id === h.id}" title="${esc(h.name)} · ${esc(h.agent)}">${esc(h.name[0])}</button>`,
    ).join('');
  }
  $('#who').addEventListener('click', (e) => {
    const b = e.target.closest('.av');
    if (b) selectAgent(byId[b.dataset.id], true);
  });
  function renderChat() {
    const a = selected,
      d = a.def,
      list = chats[d.agent];
    $('#chatName').textContent = d.name;
    $('#chatRole').textContent = `${d.title} · ${d.boss ? '' : 'subagente '}${d.agent} (${d.model})`;
    const how =
      sample || serverChat
        ? 'Escríbele: responde Claude en su papel.'
        : 'Escríbele. Sin conexión con Claude responde en modo offline (mira el README para activar el chat).';
    const msgs = $('#msgs');
    msgs.innerHTML =
      (list.length ? '' : `<div class="m note">${how}</div>`) +
      list
        .map((m, i) => {
          const last = i === list.length - 1 && m.role === 'assistant' && chatBusy;
          return `<div class="m ${m.role === 'user' ? 'me' : 'them'}"${last ? ' id="lastMsg"' : ''}>${esc(m.content || (last ? 'Pensando…' : ''))}</div>${m.note ? `<div class="m note">${esc(m.note)}</div>` : ''}`;
        })
        .join('');
    msgs.scrollTop = msgs.scrollHeight;
    $('#send').textContent = chatBusy ? 'Parar' : 'Enviar';
  }
  function updateLastMsg(t) {
    const el = document.getElementById('lastMsg');
    if (el) {
      el.textContent = t;
      $('#msgs').scrollTop = $('#msgs').scrollHeight;
    }
  }
  $('#compose').addEventListener('submit', (e) => {
    e.preventDefault();
    if (chatBusy) {
      if (chatCtl) chatCtl.abort();
      return;
    }
    const t = $('#input').value.trim();
    if (!t) return;
    $('#input').value = '';
    sendChat(t);
  });
  $('#input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#compose').requestSubmit();
    }
  });

  function renderTeam() {
    const max = Math.max(1, ...agents.map((a) => a.tok.in + a.tok.out + a.tok.chat));
    $('#team').innerHTML = agents
      .map((a) => {
        const act = activity(a),
          tot = a.tok.in + a.tok.out + a.tok.chat;
        return `<li class="card${a === selected ? ' sel' : ''}" data-id="${a.id}" tabindex="0" style="--c:${COLOR[a.id]}">
        <span class="av" style="--c:${COLOR[a.id]};cursor:inherit">${esc(a.def.name[0])}</span>
        <div style="min-width:0"><h4>${esc(a.def.name)} <i>· ${esc(a.def.agent)} · ${esc(a.def.model)}</i></h4><p>${esc(act.t)}</p><div class="meter"><span style="width:${(tot / max) * 100}%"></span></div></div>
        <div><span class="pill ${act.k}">${act.k}</span><div class="tok">${fmtTok(tot)}</div></div></li>`;
      })
      .join('');
  }
  $('#team').addEventListener('click', (e) => {
    const c = e.target.closest('.card');
    if (c) selectAgent(byId[c.dataset.id], true);
  });
  $('#team').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const c = e.target.closest('.card');
      if (c) selectAgent(byId[c.dataset.id], true);
    }
  });
  function renderIssue() {
    const chain = STAGES.map(
      (st, i) =>
        `<span class="${live ? (st.some((a) => a.job) ? 'on' : '') : !issue ? '' : issue.stage > i || issueState === 'pr' ? 'done' : issue.stage === i ? 'on' : ''}">${st.map((a) => esc(a.def.name)).join(' + ')}</span>`,
    ).join('<i>→</i>');
    $('#issueBox').innerHTML =
      `<div class="t">${live ? 'En directo con Claude Code' : issue ? `<em>#${issue.n}</em>${esc(issue.title)}` : 'Sin issue abierta'}</div><div class="chain">${chain}</div>`;
    $('#issueMini').textContent = live ? 'en directo' : issue ? `#${issue.n} en curso` : 'sin issue';
  }
  $('#source').textContent = source;
  function log(a, html) {
    const li = document.createElement('li');
    li.innerHTML = `<time>${clockText()}</time><span>${a ? `<b style="color:${COLOR[a.id]}">${esc(a.def.name)}</b> ` : ''}${html}</span>`;
    const el = $('#log');
    el.prepend(li);
    while (el.children.length > 80) el.lastChild.remove();
  }
  function clockText() {
    const hh = Math.floor(hour),
      mm = Math.floor((hour - hh) * 60);
    return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  }
  const SUN_ICON =
    '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.2" fill="#ffb547"/><g stroke="#ffb547" stroke-width="1.4" stroke-linecap="round"><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/></g></svg>';
  const MOON_ICON =
    '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M11.5 10.8A5 5 0 0 1 5.2 4.5 5 5 0 1 0 11.5 10.8Z" fill="#c9d3ff"/></svg>';
  function renderNav() {
    $('#clock').innerHTML = (hour < 6.5 || hour >= 19.5 ? MOON_ICON : SUN_ICON) + clockText();
    const phase = isNight(hour)
      ? 'noche'
      : isStandup(hour)
        ? 'daily'
        : isLunch(hour)
          ? 'comida'
          : hour < 12
            ? 'mañana'
            : hour < 19.5
              ? 'tarde'
              : 'anochecer';
    $('#day').textContent = `Día ${day} · ${phase}`;
    const agentTok = agents.reduce((s, a) => s + a.tok.in + a.tok.out, 0);
    $('#tokTotal').textContent = fmtTok(agentTok + chatTok);
    $('#tokSplit').textContent = `agentes ${fmtTok(agentTok)}${live ? '' : ' (sim.)'} · chat ${fmtTok(chatTok)}`;
    $('#prs').textContent = prCount;
  }
  function setSpeed(mode, quiet) {
    speedMode = mode;
    document
      .querySelectorAll('.seg button')
      .forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.speed === mode)));
    if (mode === 'real') {
      const n = new Date();
      hour = n.getHours() + n.getMinutes() / 60;
    }
    if (!quiet)
      log(
        null,
        mode === 'real'
          ? 'La oficina sigue tu hora real.'
          : mode === 'fast'
            ? 'Un día dura 6 minutos.'
            : 'Un día dura 2 minutos.',
      );
  }
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setSpeed(b.dataset.speed)));
  $('#pause').addEventListener('click', (e) => {
    paused = !paused;
    e.currentTarget.textContent = paused ? 'Reanudar' : 'Pausar';
  });

  /* cargar agentes .md sin servidor: se guardan en el navegador y se recarga la oficina */
  if (server) $('#loadBtn').hidden = true;
  $('#loadDir').addEventListener('change', async (e) => {
    const files = [...e.target.files].filter(
      (f) =>
        /\.md$/i.test(f.name) &&
        !/(^|\/)CLAUDE\.md$/i.test(f.webkitRelativePath || f.name) &&
        !/\/(commands|skills|output-styles)\//i.test(f.webkitRelativePath || ''),
    );
    const inAgents = files.filter((f) => /(^|\/)agents\//i.test(f.webkitRelativePath || ''));
    const use = inAgents.length ? inAgents : files;
    if (!use.length) {
      log(null, 'No he encontrado archivos .md de agentes en esa carpeta.');
      return;
    }
    const parsed = [];
    for (const f of use) parsed.push(parseAgentMd(await f.text(), f.name));
    store.set('ao-agentes', parsed);
    location.reload();
  });

  function resize() {
    const w = sceneEl.clientWidth,
      h = sceneEl.clientHeight;
    if (!renderer || !w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(sceneEl);

  agents.forEach((a) => {
    const s = desiredSpot(a);
    a.target = s;
    a.arrived = true;
    a.root.position.set(s.x, 0, s.z);
    a.ry = s.ry;
    a.root.rotation.y = s.ry;
  });
  drawKanban();
  renderIssue();
  renderWho();
  renderChat();
  renderTeam();
  renderNav();
  updateSky();
  log(null, `Se abre la oficina con ${agents.length - 1} agentes. ${boss.def.name} está en su despacho.`);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawKanban);
  startLive();

  let last = performance.now(),
    uiT = 0,
    prevNight = isNight(hour);
  function frame(now) {
    const rdt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dt = paused ? 0 : rdt;
    if (!paused) {
      if (speedMode === 'real') {
        const n = new Date();
        hour = n.getHours() + n.getMinutes() / 60 + n.getSeconds() / 3600;
      } else {
        hour += dt * SPEED[speedMode];
        if (hour >= 24) {
          hour -= 24;
          day++;
          log(null, `Empieza el día ${day}.`);
        }
      }
      const nNight = isNight(hour);
      if (nNight !== prevNight) {
        log(null, nNight ? 'Se hace de noche: el escuadrón se va a descansar.' : 'Amanece en la oficina.');
        prevNight = nNight;
      }
      agents.forEach((a) => updateAgent(a, dt));
      updatePipeline(dt);
      checkLiveIdle();
      updateSky();
    }
    if (focusTarget && controls) {
      const d = focusTarget
        .clone()
        .sub(controls.target)
        .multiplyScalar(Math.min(1, rdt * 4));
      controls.target.add(d);
      camera.position.add(d);
      if (d.lengthSq() < 1e-5) focusTarget = null;
    }
    if (controls) controls.update();
    if (renderer) {
      renderer.render(scene, camera);
      placeLabels(sceneEl.clientWidth, sceneEl.clientHeight);
    }
    uiT -= rdt;
    if (uiT <= 0) {
      uiT = 0.5;
      renderNav();
      if (!$('[data-panel="team"]').hidden) renderTeam();
    }
    requestAnimationFrame(frame);
  }
  resize();
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });

  /* acceso para depurar desde la consola del navegador */
  window.agentOffice = {
    agents,
    SPOTS,
    STAGES,
    findPath,
    get hour() {
      return hour;
    },
    set hour(v) {
      hour = v;
    },
    get issue() {
      return issue;
    },
    get prs() {
      return prCount;
    },
    step(n, h) {
      for (let i = 0; i < n; i++) {
        if (h != null) hour = h;
        agents.forEach((a) => updateAgent(a, 0.05));
        updatePipeline(0.05);
      }
    },
    camera,
    controls,
    onLiveEvent,
  };
})();
