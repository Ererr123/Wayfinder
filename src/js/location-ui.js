import { calcLST } from './sidereal.js';

function fmt12h(d) {
  let h = d.getHours(), m = String(d.getMinutes()).padStart(2,'0'),
      s = String(d.getSeconds()).padStart(2,'0'), ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m}:${s} ${ap}`;
}

export function initLocationPanel(onOrient) {

  const addrEl  = document.getElementById('loc-address');
  const gpsBtn  = document.getElementById('loc-gps');
  const latEl   = document.getElementById('loc-lat');
  const lonEl   = document.getElementById('loc-lon');
  const yearEl  = document.getElementById('loc-year');
  const monthEl = document.getElementById('loc-month');
  const dayEl   = document.getElementById('loc-day');
  const timeEl  = document.getElementById('loc-time');
  const applyEl = document.getElementById('loc-apply');
  const lstEl   = document.getElementById('loc-lst');
  const lstRow  = document.getElementById('loc-lst-row');
  const header  = document.getElementById('loc-header');
  const body    = document.getElementById('loc-body');

  let clockInterval = null;
  let debounceTimer = null;
  let suggestions   = [];
  let collapsed     = false;
  let savedLat      = null;
  let savedLon      = null;

  // ── Date helpers ──────────────────────────────────────────────────────────
  function selectedDate() {
    const y  = parseInt(yearEl.value)  || new Date().getFullYear();
    const mo = (parseInt(monthEl.value) || 1) - 1;
    const d  = parseInt(dayEl.value)   || 1;
    const [th, tm] = (timeEl.value || '00:00').split(':').map(Number);
    return new Date(y, mo, d, th, tm, 0, 0);
  }

  function writeDate(dt) {
    yearEl.value  = dt.getFullYear();
    monthEl.value = String(dt.getMonth() + 1).padStart(2, '0');
    dayEl.value   = String(dt.getDate()).padStart(2, '0');
  }

  function writeTime(dt) {
    timeEl.value = `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
  }

  // ── Collapse ──────────────────────────────────────────────────────────────
  header.addEventListener('click', () => {
    collapsed = !collapsed;
    body.style.display = collapsed ? 'none' : 'flex';
    document.getElementById('loc-toggle').textContent = collapsed ? '▸' : '▾';
  });

  // ── Dropdown ──────────────────────────────────────────────────────────────
  const drop = document.createElement('div');
  drop.id    = 'loc-dropdown';
  document.body.appendChild(drop);

  function positionDrop() {
    const r = addrEl.getBoundingClientRect();
    Object.assign(drop.style, { position:'fixed', top: r.bottom+2+'px', left: r.left+'px', width: r.width+'px' });
  }
  function renderDrop() {
    drop.innerHTML = '';
    if (!suggestions.length) { drop.style.display = 'none'; return; }
    suggestions.forEach((s, i) => {
      const row = document.createElement('div');
      row.className   = 'loc-suggestion';
      row.textContent = s.label;
      row.addEventListener('mousedown', e => { e.preventDefault(); pickSuggestion(i); });
      drop.appendChild(row);
    });
    positionDrop();
    drop.style.display = 'block';
  }
  function hideDrop() { drop.style.display = 'none'; suggestions = []; }
  function pickSuggestion(i) {
    const item = suggestions[i];
    if (!item) return;
    addrEl.value = '';
    hideDrop();
    applyLatLon(item.lat, item.lon);
  }

  async function search(q) {
    try {
      const url  = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`;
      const data = await (await fetch(url, { headers: { 'Accept-Language': 'en' } })).json();
      suggestions = data.map(r => ({
        label : r.display_name,
        lat   : parseFloat(r.lat),
        lon   : parseFloat(r.lon),
      }));
    } catch { suggestions = []; }
    renderDrop();
  }

  addrEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = addrEl.value.trim();
    if (q.length < 2) { hideDrop(); return; }
    debounceTimer = setTimeout(() => search(q), 350);
  });
  addrEl.addEventListener('keydown', e => {
    if (e.key === 'Escape') { hideDrop(); return; }
    if (e.key === 'Enter')  { e.preventDefault(); pickSuggestion(0); }
  });
  addrEl.addEventListener('blur', () => setTimeout(hideDrop, 200));
  window.addEventListener('resize', () => { if (drop.style.display === 'block') positionDrop(); });

  // ── Date arrow-key handlers — each field carries into the next ────────────
  // Year: ±1 year, clamp day if new year has fewer days in that month
  yearEl.addEventListener('keydown', e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const dir = e.key === 'ArrowUp' ? 1 : -1;
    const dt  = selectedDate();
    const origMo = dt.getMonth(), origDay = dt.getDate();
    dt.setDate(1);
    dt.setFullYear(dt.getFullYear() + dir);
    dt.setDate(Math.min(origDay, new Date(dt.getFullYear(), origMo + 1, 0).getDate()));
    writeDate(dt);
    onDateTimeChange();
  });

  // Month: ±1 month, JS Date carries Dec→Jan into the next year automatically,
  // day is clamped to the last valid day of the new month
  monthEl.addEventListener('keydown', e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const dir    = e.key === 'ArrowUp' ? 1 : -1;
    const dt     = selectedDate();
    const origDay = dt.getDate();
    dt.setDate(1);
    dt.setMonth(dt.getMonth() + dir);
    dt.setDate(Math.min(origDay, new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate()));
    writeDate(dt);
    onDateTimeChange();
  });

  // Day: ±1 day, JS Date carries Jul 31+1 → Aug 1, Dec 31+1 → Jan 1 next year
  dayEl.addEventListener('keydown', e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const dir = e.key === 'ArrowUp' ? 1 : -1;
    const dt  = selectedDate();
    dt.setDate(dt.getDate() + dir);
    writeDate(dt);
    onDateTimeChange();
  });

  // ── Validation ────────────────────────────────────────────────────────────
  function setError(el, bad) {
    el.classList.toggle('input-error', bad);
  }

  function validateLatLon() {
    const lat = parseFloat(latEl.value), lon = parseFloat(lonEl.value);
    const latOk = !isNaN(lat) && lat >= -90  && lat <= 90;
    const lonOk = !isNaN(lon) && lon >= -180 && lon <= 180;
    setError(latEl, latEl.value !== '' && !latOk);
    setError(lonEl, lonEl.value !== '' && !lonOk);
    return latOk && lonOk;
  }

  function clampDate() {
    let y = parseInt(yearEl.value),  m = parseInt(monthEl.value),
        d = parseInt(dayEl.value);
    if (isNaN(y) || y < 1900) { y = 1900; yearEl.value = y; }
    if (y > 2100)              { y = 2100; yearEl.value = y; }
    if (isNaN(m) || m < 1)    { m = 1;    monthEl.value = '01'; }
    if (m > 12)                { m = 12;   monthEl.value = '12'; }
    const last = new Date(y, m, 0).getDate();
    if (isNaN(d) || d < 1)  { d = 1;    dayEl.value = '01'; }
    if (d > last)            { d = last; dayEl.value = String(last).padStart(2,'0'); }
    const yOk = y >= 1900 && y <= 2100;
    const mOk = m >= 1 && m <= 12;
    const dOk = d >= 1 && d <= last;
    setError(yearEl,  !yOk);
    setError(monthEl, !mOk);
    setError(dayEl,   !dOk);
    return yOk && mOk && dOk;
  }

  latEl.addEventListener('input',  validateLatLon);
  lonEl.addEventListener('input',  validateLatLon);

  // Manual typing in any date field — clamp then re-orient
  [yearEl, monthEl, dayEl].forEach(el => el.addEventListener('change', () => {
    if (clampDate()) onDateTimeChange();
  }));

  // ── Time arrow-key handler — hours/minutes/AM-PM carry into date ──────────
  // selectionStart is unreliable for type="time" — instead, let the browser
  // change the value then diff before/after to derive the real delta.
  let _timePrev = '', _skipTimeInput = false;

  function selectedDateWithTime(timeStr) {
    const y  = parseInt(yearEl.value)  || new Date().getFullYear();
    const mo = (parseInt(monthEl.value) || 1) - 1;
    const d  = parseInt(dayEl.value)   || 1;
    const [th, tm] = timeStr.split(':').map(Number);
    return new Date(y, mo, d, th, tm, 0, 0);
  }

  timeEl.addEventListener('keydown', e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    _timePrev = timeEl.value;   // capture before browser mutates value
  });

  timeEl.addEventListener('input', () => {
    if (_skipTimeInput) { _skipTimeInput = false; return; }
    if (!_timePrev) { onDateTimeChange(); return; }

    const prev = _timePrev;
    _timePrev = '';

    const [pH, pM] = prev.split(':').map(Number);
    const [nH, nM] = timeEl.value.split(':').map(Number);
    let deltaMins = (nH * 60 + nM) - (pH * 60 + pM);

    // Correct for browser wrapping:
    // > +720 min means it wrapped backward (e.g. 0→23 h) — subtract a day
    // < -720 min means it wrapped forward  (e.g. 23→0 h) — add a day
    if (deltaMins >  720) deltaMins -= 1440;
    if (deltaMins < -720) deltaMins += 1440;

    const newDt = new Date(selectedDateWithTime(prev).getTime() + deltaMins * 60_000);
    _skipTimeInput = true;
    writeDate(newDt);
    writeTime(newDt);
    onDateTimeChange();
  });

  // ── Orient sky when date/time changes ────────────────────────────────────
  function onDateTimeChange() {
    if (savedLat === null) return;
    if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
    const dt = selectedDate();
    lstEl.textContent = fmt12h(dt);
    onOrient(savedLat, savedLon, calcLST(dt, savedLon));
  }

  // ── GPS ───────────────────────────────────────────────────────────────────
  gpsBtn.addEventListener('click', () => {
    if (!navigator.geolocation) { gpsBtn.textContent = 'Not supported'; return; }
    gpsBtn.textContent = 'Detecting…'; gpsBtn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      pos => { gpsBtn.textContent = 'Use GPS'; gpsBtn.disabled = false; applyLatLon(pos.coords.latitude, pos.coords.longitude); },
      ()  => { gpsBtn.textContent = 'GPS failed'; gpsBtn.disabled = false; },
      { timeout: 8000 }
    );
  });

  applyEl.addEventListener('click', () => {
    if (!validateLatLon()) return;
    if (!clampDate())      return;
    applyLatLon(parseFloat(latEl.value), parseFloat(lonEl.value));
  });

  // ── Core ──────────────────────────────────────────────────────────────────
  function applyLatLon(lat, lon) {
    savedLat = lat; savedLon = lon;
    latEl.value = lat.toFixed(4);
    lonEl.value = lon.toFixed(4);
    const now = new Date();
    writeDate(now);
    writeTime(now);
    onOrient(lat, lon, calcLST(now, lon));
    lstRow.style.display = 'flex';
    lstEl.textContent    = fmt12h(now);
    if (clockInterval) clearInterval(clockInterval);
    clockInterval = setInterval(() => {
      const n = new Date();
      lstEl.textContent = fmt12h(n);
      if (n.getSeconds() === 0) {
        writeDate(n);
        writeTime(n);
        onOrient(savedLat, savedLon, calcLST(n, savedLon));
      }
    }, 1000);
  }

  // ── Auto-detect (also used by Reset button) ──────────────────────────────
  function autoDetect() {
    gpsBtn.textContent = 'Detecting…'; gpsBtn.disabled = true;
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => { gpsBtn.textContent = 'Use GPS'; gpsBtn.disabled = false; applyLatLon(pos.coords.latitude, pos.coords.longitude); },
        async () => {
          gpsBtn.textContent = 'Use GPS'; gpsBtn.disabled = false;
          try {
            const d = await (await fetch('https://ipapi.co/json/')).json();
            if (d.latitude) applyLatLon(+d.latitude, +d.longitude);
          } catch {}
        },
        { timeout: 8000, maximumAge: 300000 }
      );
    } else {
      gpsBtn.textContent = 'Use GPS'; gpsBtn.disabled = false;
    }
  }

  document.getElementById('loc-reset').addEventListener('click', autoDetect);

  autoDetect();
}
