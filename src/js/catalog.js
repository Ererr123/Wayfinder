import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

export const CONSTELLATIONS = {
  Orion: [
    ["Betelgeuse","Bellatrix"], ["Betelgeuse","Alnilam"],
    ["Bellatrix","Mintaka"],    ["Mintaka","Alnilam"],
    ["Alnilam","Alnitak"],      ["Alnilam","Rigel"],
    ["Alnilam","Saiph"],        ["Rigel","Saiph"],
    ["Rigel","Cursa"],
  ],
  "Big Dipper": [
    ["Alkaid","Mizar"],  ["Mizar","Alioth"],
    ["Alioth","Megrez"], ["Megrez","Phecda"],
    ["Megrez","Dubhe"],  ["Dubhe","Merak"],
    ["Merak","Phecda"],
  ],
  Cassiopeia: [
    ["Caph","Schedar"], ["Schedar","Navi"],
    ["Navi","Ruchbah"],
  ],
  Scorpius: [
    ["Antares","Dschubba"], ["Antares","Graffias"],
    ["Antares","Shaula"],   ["Shaula","Lesath"],
  ],
  Cygnus: [
    ["Deneb","Sadr"], ["Sadr","Aljanah"],
    ["Sadr","Albireo"],
  ],
};

export async function loadStarCatalog() {
  const response = await fetch('data/hyg_v42.csv');
  const text = await response.text();
  const lines = text.split('\n');

  const firstLine = lines[0];
  const delimiter = firstLine.includes(',') ? ',' : (firstLine.includes('\t') ? '\t' : null);
  if (!delimiter) throw new Error('Cannot detect delimiter in CSV');

  const clean = s => s ? s.replace(/^"|"$/g, '').trim() : '';
  const header = firstLine.split(delimiter).map(clean);
  const col = name => header.findIndex(h => h.toLowerCase() === name);

  const nameIdx = col('proper'), raIdx = col('ra'), decIdx = col('dec');
  const magIdx  = col('mag'),    distIdx = col('dist'), specIdx = col('spect');

  if (nameIdx < 0 || raIdx < 0 || decIdx < 0 || magIdx < 0) {
    throw new Error('Required columns missing in CSV');
  }

  const catalog = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(delimiter).map(clean);

    const name = cols[nameIdx];
    if (!name) continue;

    const ra  = parseFloat(cols[raIdx]);
    const dec = parseFloat(cols[decIdx]);
    const mag = parseFloat(cols[magIdx]);
    if (isNaN(ra) || isNaN(dec) || isNaN(mag)) continue;
    if (ra < 0 || ra > 24 || dec < -90 || dec > 90) continue;

    const dist = distIdx >= 0 ? (parseFloat(cols[distIdx]) || 0) : 0;
    const spec = specIdx >= 0 ? (cols[specIdx] || '') : '';

    catalog.push([name, ra, dec, mag, dist, spec]);
  }

  return catalog;
}

export function radec2xyz(ra_h, dec_deg, r = 500) {
  const ra  = ra_h * (Math.PI / 12);
  const dec = dec_deg * (Math.PI / 180);
  return new THREE.Vector3(
    r * Math.cos(dec) * Math.cos(ra),
    r * Math.sin(dec),
    r * Math.cos(dec) * Math.sin(ra)
  );
}

export function spectralColor(spec = '') {
  const map = {
    O: [0.72, 0.82, 1.00],
    B: [0.82, 0.91, 1.00],
    A: [1.00, 1.00, 1.00],
    F: [1.00, 0.98, 0.88],
    G: [1.00, 0.94, 0.65],
    K: [1.00, 0.78, 0.44],
    M: [1.00, 0.56, 0.36],
  };
  const [r, g, b] = map[spec.charAt(0).toUpperCase()] || [1, 1, 1];
  return new THREE.Color(r, g, b);
}

export function magToSize(mag) {
  return Math.max(1.4, 9.5 - mag * 1.9);
}
