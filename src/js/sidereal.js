// Calculates Local Sidereal Time using astronomy-engine (window.Astronomy)
// with a built-in fallback if the library isn't loaded.

export function calcLST(date, longitude_deg) {
  const gmst = _gmst(date);
  return ((gmst + longitude_deg / 15) % 24 + 24) % 24;
}

export function fmtHMS(hours) {
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  const s = Math.floor(((hours - h) * 60 - m) * 60);
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

function _gmst(date) {
  if (window.Astronomy?.SiderealTime) {
    return window.Astronomy.SiderealTime(date);
  }
  // Fallback: standard GMST approximation (Meeus, accurate to ~0.1s over decades)
  const jd = date.getTime() / 86400000 + 2440587.5;
  const D  = jd - 2451545.0;
  return ((18.697374558 + 24.06570982441908 * D) % 24 + 24) % 24;
}
