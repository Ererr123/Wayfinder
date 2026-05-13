import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { loadStarCatalog, radec2xyz, spectralColor, magToSize, CONSTELLATIONS } from './catalog.js';
import { calcLST } from './sidereal.js';
import { initLocationPanel } from './location-ui.js';
import { createGroundMap } from './ground-map.js';
import { createGrassField } from './grass.js';
import { createTreeLine }  from './trees.js';

const DEFAULT_LAT = 40;

// Rotation matrix: celestial frame → observer local frame (+X=east, +Y=up, +Z=north).
// Rows are the east, zenith, north unit vectors expressed in celestial coordinates.
function computeSkyMatrix(lat_deg, lst_hours) {
  const lat  = lat_deg   * Math.PI / 180;
  const lst  = lst_hours * Math.PI / 12;
  const sLat = Math.sin(lat), cLat = Math.cos(lat);
  const sLST = Math.sin(lst), cLST = Math.cos(lst);

  return new THREE.Matrix4().set(
    -sLST,         0,      cLST,        0,
     cLat * cLST,  sLat,   cLat * sLST, 0,
    -sLat * cLST,  cLat,  -sLat * sLST, 0,
     0,            0,      0,           1
  );
}

async function init() {
  const catalog = await loadStarCatalog();
  const canvas  = document.getElementById('c');
  let W = window.innerWidth, H = window.innerHeight;

  // alpha: true → canvas is transparent where nothing is drawn,
  // letting the Mapbox div behind show through.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(W, H);
  renderer.setClearColor(0x000000, 0);  // transparent clear

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, W / H, 0.1, 5000);
  camera.position.set(0, 0, 0);

  // ── Sky pivot ─────────────────────────────────────────────────────────────
  const skyPivot = new THREE.Object3D();
  skyPivot.matrixAutoUpdate = false;
  scene.add(skyPivot);

  // Stars
  const positions = [], colors = [], sizes = [];
  catalog.forEach(s => {
    const p = radec2xyz(s[1], s[2]);
    positions.push(p.x, p.y, p.z);
    const c = spectralColor(s[5]);
    colors.push(c.r, c.g, c.b);
    sizes.push(magToSize(s[3]));
  });

  const starGeom = new THREE.BufferGeometry();
  starGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  starGeom.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3));
  starGeom.setAttribute('size',     new THREE.Float32BufferAttribute(sizes, 1));

  const starMat = new THREE.ShaderMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    uniforms: { selectedIdx: { value: -1.0 } },
    vertexShader: `
      attribute float size;
      varying vec3  vColor;
      varying float vSel;
      uniform float selectedIdx;
      void main() {
        vColor = color;
        float isSel = step(abs(float(gl_VertexID) - selectedIdx), 0.5);
        vSel = isSel;
        gl_PointSize = size * (1.0 + isSel * 2.2);
        gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3  vColor;
      varying float vSel;
      void main() {
        vec2  uv   = gl_PointCoord - 0.5;
        float dist = length(uv);
        if (dist > 0.5) discard;
        float core = 1.0 - smoothstep(0.0,  0.15, dist);
        float halo = 1.0 - smoothstep(0.12, 0.50, dist);
        float a    = clamp(core + halo * 0.55, 0.0, 1.0);
        vec3 col = mix(vColor, vec3(1.0), core * 0.45);
        if (vSel > 0.5) {
          col = mix(vec3(1.0, 0.88, 0.28), vec3(1.0), core * 0.5);
          a  *= 1.2;
        }
        gl_FragColor = vec4(col, a);
      }
    `,
  });

  const starPoints = new THREE.Points(starGeom, starMat);
  skyPivot.add(starPoints);


  // Celestial equator
  const eqPts = [];
  for (let i = 0; i <= 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    eqPts.push(496 * Math.cos(a), 0, 496 * Math.sin(a));
  }
  const eqGeom = new THREE.BufferGeometry();
  eqGeom.setAttribute('position', new THREE.Float32BufferAttribute(eqPts, 3));
  skyPivot.add(new THREE.Line(eqGeom, new THREE.LineBasicMaterial({
    color: 0x1133aa, opacity: 0.12, transparent: true,
  })));

  // Constellation lines
  const nameToIdx = {};
  catalog.forEach((s, i) => { nameToIdx[s[0]] = i; });
  const lineVerts = [];
  Object.values(CONSTELLATIONS).flat().forEach(([a, b]) => {
    const ia = nameToIdx[a], ib = nameToIdx[b];
    if (ia == null || ib == null) return;
    const pa = radec2xyz(catalog[ia][1], catalog[ia][2], 496);
    const pb = radec2xyz(catalog[ib][1], catalog[ib][2], 496);
    lineVerts.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
  });
  const lineGeom = new THREE.BufferGeometry();
  lineGeom.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3));
  skyPivot.add(new THREE.LineSegments(lineGeom, new THREE.LineBasicMaterial({
    color: 0x2255bb, opacity: 0.32, transparent: true,
  })));

  // ── Ground — procedural grass texture ─────────────────────────────────────
  // Night grass ground — very dark green, fine noise variation
  const grassCanvas = document.createElement('canvas');
  grassCanvas.width = grassCanvas.height = 512;
  const gCtx = grassCanvas.getContext('2d');

  const px = gCtx.getImageData(0, 0, 512, 512);
  const d  = px.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    d[i]   = Math.max(0, Math.min(255,  3 + n * 0.4));   // R — very low
    d[i+1] = Math.max(0, Math.min(255,  8 + n * 0.8));   // G — dominant but dark
    d[i+2] = Math.max(0, Math.min(255,  2 + n * 0.3));   // B — very low
    d[i+3] = 255;
  }
  gCtx.putImageData(px, 0, 0);

  const grassTex  = new THREE.CanvasTexture(grassCanvas);
  grassTex.wrapS  = grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.repeat.set(40, 40);

  const groundMesh = new THREE.Mesh(
    new THREE.CircleGeometry(140, 80),
    new THREE.MeshBasicMaterial({ map: grassTex })
  );
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = -0.5;
  scene.add(groundMesh);

  // ── Grass field + tree line ────────────────────────────────────────────────
  const grassMat = createGrassField(scene);
  createTreeLine(scene);

  // ── Sky matrix ─────────────────────────────────────────────────────────────
  function setSkyMatrix(m) {
    skyPivot.matrix.copy(m);
    skyPivot.matrixWorldNeedsUpdate = true;
  }

  let autoSpin    = true;
  let autoSpinLST = 0;
  setSkyMatrix(computeSkyMatrix(DEFAULT_LAT, 0));

  // ── Camera / view state ────────────────────────────────────────────────────
  // azimuth:  compass bearing (0 = north, π = south, clockwise)
  // altitude: radians above horizon (0 = horizontal, π/2 = zenith)
  let azimuth  = Math.PI;
  let altitude = 0.1;
  let fov      = 70;

  const _lookTarget = new THREE.Vector3();
  const _lookMat    = new THREE.Matrix4();
  const _worldUp    = new THREE.Vector3(0, 1, 0);
  const _camOrigin  = new THREE.Vector3(0, 0, 0);

  // Ground map
  const groundMap = createGroundMap('map-view');
  const horizonEl = document.getElementById('horizon-line');
  let locationSet = false;

  function horizonY() {
    const fovRad = fov * Math.PI / 180;
    return H / 2 + H / 2 * Math.tan(altitude) / Math.tan(fovRad / 2);
  }

  function updateView() {
    // Camera orientation
    _lookTarget.set(
      Math.sin(azimuth) * Math.cos(altitude),
      Math.sin(altitude),
      Math.cos(azimuth) * Math.cos(altitude)
    );
    _lookMat.lookAt(_camOrigin, _lookTarget, _worldUp);
    camera.quaternion.setFromRotationMatrix(_lookMat);

    if (locationSet) {
      const hY = horizonY();
      horizonEl.style.top    = `${hY}px`;
      horizonEl.style.opacity = (hY > 0 && hY < H) ? '1' : '0';
      groundMap.update(azimuth * 180 / Math.PI, altitude, hY, H);
    }
  }
  updateView();

  // ── Controls ───────────────────────────────────────────────────────────────
  let isDragging = false;
  let prevX = 0, prevY = 0, downX = 0, downY = 0;

  canvas.addEventListener('mousedown', e => {
    isDragging = true;
    prevX = downX = e.clientX;
    prevY = downY = e.clientY;
    canvas.classList.add('dragging');
  });

  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    azimuth  += (e.clientX - prevX) * 0.003;
    altitude -= (e.clientY - prevY) * 0.003;
    altitude  = Math.max(-0.15, Math.min(Math.PI / 2 * 0.97, altitude));
    prevX = e.clientX; prevY = e.clientY;
    updateView();
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
    canvas.classList.remove('dragging');
  });

  canvas.addEventListener('touchstart', e => {
    isDragging = true;
    prevX = downX = e.touches[0].clientX;
    prevY = downY = e.touches[0].clientY;
  }, { passive: true });

  canvas.addEventListener('touchmove', e => {
    if (!isDragging) return;
    e.preventDefault();
    azimuth  += (e.touches[0].clientX - prevX) * 0.003;
    altitude -= (e.touches[0].clientY - prevY) * 0.003;
    altitude  = Math.max(-0.15, Math.min(Math.PI / 2 * 0.97, altitude));
    prevX = e.touches[0].clientX; prevY = e.touches[0].clientY;
    updateView();
  }, { passive: false });

  canvas.addEventListener('touchend', () => { isDragging = false; });

  window.addEventListener('wheel', e => {
    fov = Math.max(10, Math.min(90, fov + e.deltaY * 0.04));
    camera.fov = fov;
    camera.updateProjectionMatrix();
    if (locationSet) updateView();
  }, { passive: true });

  // ── Star selection ─────────────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const mouse     = new THREE.Vector2();

  function starWorldPos(idx) {
    const s = catalog[idx];
    return radec2xyz(s[1], s[2], 1).applyMatrix4(skyPivot.matrix);
  }

  function isStarVisible(idx) {
    if (!locationSet) return true;          // no location yet — assume visible
    return starWorldPos(idx).y > 0;        // above horizon
  }

  function selectStar(idx) {
    starMat.uniforms.selectedIdx.value = idx;
    const s = catalog[idx];
    document.getElementById('star-name').textContent = s[0].toUpperCase();
    document.getElementById('i-mag').textContent  = Number(s[3]).toFixed(2);
    document.getElementById('i-ra').textContent   = `${Number(s[1]).toFixed(4)} h`;
    document.getElementById('i-dec').textContent  = `${Number(s[2]).toFixed(2)}°`;
    document.getElementById('i-dist').textContent = `${s[4]} ly`;
    document.getElementById('i-spec').textContent = s[5] || '-';
    document.getElementById('i-not-visible').style.display = isStarVisible(idx) ? 'none' : 'block';
    document.getElementById('info-panel').style.display = 'block';
  }

  function pointCameraAtStar(idx) {
    if (!isStarVisible(idx)) return;       // don't redirect camera to below-horizon stars
    const wp = starWorldPos(idx);
    altitude = Math.asin(Math.max(-1, Math.min(1, wp.y)));
    azimuth  = Math.atan2(wp.x, wp.z);
    if (azimuth < 0) azimuth += 2 * Math.PI;
    altitude = Math.max(-0.15, Math.min(Math.PI / 2 * 0.97, altitude));
    updateView();
  }

  canvas.addEventListener('click', e => {
    const dx = e.clientX - downX, dy = e.clientY - downY;
    if (dx * dx + dy * dy > 30) return;
    mouse.x =  (e.clientX / W) * 2 - 1;
    mouse.y = -(e.clientY / H) * 2 + 1;
    raycaster.params.Points.threshold = 3.5 * (fov / 70);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(starPoints);
    if (hits.length) selectStar(hits[0].index);
  });

  document.getElementById('info-close').addEventListener('click', () => {
    document.getElementById('info-panel').style.display = 'none';
    starMat.uniforms.selectedIdx.value = -1;
  });

  // ── Search ─────────────────────────────────────────────────────────────────
  const searchInput   = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  const searchDivider = document.getElementById('search-divider');

  const clearSearch = () => {
    searchResults.innerHTML = '';
    searchDivider.style.display = 'none';
  };

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase().trim();
    if (q.length < 1) { clearSearch(); return; }

    const hits = catalog
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s[0].toLowerCase().includes(q))
      .slice(0, 8);

    if (!hits.length) { clearSearch(); return; }

    searchDivider.style.display = 'block';
    searchResults.innerHTML = hits.map(({ s, i }) =>
      `<div class="result-item" data-idx="${i}">
         <span>${s[0]}</span>
         <span class="result-mag">mag ${Number(s[3]).toFixed(2)}</span>
       </div>`
    ).join('');

    searchResults.querySelectorAll('.result-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx);
        selectStar(idx);
        pointCameraAtStar(idx);
        searchInput.value = catalog[idx][0];
        clearSearch();
      });
    });
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#search-wrap')) clearSearch();
  });

  // ── Location → sky + map orientation ──────────────────────────────────────
  function orientToLocation(lat_deg, lon_deg, lst_hours) {
    setSkyMatrix(computeSkyMatrix(lat_deg, lst_hours));
    autoSpin   = false;
    locationSet = true;
    azimuth    = Math.PI;
    altitude   = 0.1;

    if (groundMap.isReady) groundMap.setLocation(lat_deg, lon_deg);

    horizonEl.style.display = 'block';
    updateView();
  }

  initLocationPanel(orientToLocation);

  // ── Render loop ────────────────────────────────────────────────────────────
  document.getElementById('counter').textContent = `${catalog.length} named stars`;

  function animate() {
    requestAnimationFrame(animate);
    grassMat.uniforms.uTime.value = performance.now() * 0.001;
    if (autoSpin) {
      autoSpinLST = (autoSpinLST + 0.001) % 24;
      setSkyMatrix(computeSkyMatrix(DEFAULT_LAT, autoSpinLST));
    }
    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener('resize', () => {
    W = window.innerWidth; H = window.innerHeight;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H);
    if (locationSet) updateView();
  });
}

init();
