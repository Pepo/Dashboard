/* ===================================================
   Dashboard – Frontend Logic
   =================================================== */

const DE_DAYS  = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
const DE_MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const DE_DAYS_SHORT = ['So','Mo','Di','Mi','Do','Fr','Sa'];

// ── Uhr ──────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const hh  = String(now.getHours()).padStart(2,'0');
  const mm  = String(now.getMinutes()).padStart(2,'0');
  document.getElementById('clock').textContent = `${hh}:${mm}`;

  const day  = DE_DAYS[now.getDay()];
  const date = now.getDate();
  const mon  = DE_MONTHS[now.getMonth()];
  const year = now.getFullYear();
  document.getElementById('date-display').textContent = `${day}, ${date}. ${mon} ${year}`;
}

setInterval(updateClock, 1000);
updateClock();

// ── Hilfsfunktionen ──────────────────────────────────
function fmtTime(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function timeSince(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60)  return `vor ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60)  return `vor ${m} Min.`;
  return `vor ${Math.round(m/60)}h`;
}

function formatDuration(min) {
  if (min < 60) return `${min} Min.`;
  return `${Math.floor(min/60)}h ${min%60}Min.`;
}

function minutesUntil(iso) {
  return Math.round((new Date(iso) - Date.now()) / 60000);
}

function lineBadgeClass(mode) {
  const m = (mode || '').toLowerCase();
  if (m === 'bus')    return 'bus';
  if (m === 'tram' || m === 'strassenbahn') return 'tram';
  if (m === 'subway' || m === 'u-bahn')     return 'ubahn';
  if (m === 'suburban' || m === 's-bahn')   return 'sbahn';
  return '';
}

// ── ÖPNV ─────────────────────────────────────────────
let _journeys = [];

async function loadTransport() {
  const btn     = document.querySelector('#transport-card .refresh-btn');
  const content = document.getElementById('transport-content');

  btn.classList.add('spinning');
  content.innerHTML = '<div class="loading-state">Lädt…</div>';

  try {
    const res  = await fetch('/api/transport');
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Unbekannter Fehler');

    const { journeys } = data;
    _journeys = journeys || [];

    if (!journeys || journeys.length === 0) {
      content.innerHTML = '<div class="empty-state">Keine Verbindungen gefunden.</div>';
      return;
    }

    const slides = journeys.map((j, i) => {
      const depMin    = minutesUntil(j.departure);
      const isNext    = i === 0;
      const depStr    = fmtTime(j.departure);
      const arrStr    = fmtTime(j.arrival);
      const legBadges = j.legs.map(l =>
        `<span class="line-badge ${lineBadgeClass(l.mode)}">${l.name}</span>`
      ).join('');
      const depDelay = j.depDelay > 0
        ? `<span class="delay">+${Math.round(j.depDelay)}'</span>` : '';
      const arrDelay = j.arrDelay > 0
        ? `<span class="delay" style="font-size:.65rem">+${Math.round(j.arrDelay)}'</span>` : '';
      const inMin = depMin <= 0
        ? '<span style="color:var(--red);font-size:.75rem">Jetzt</span>'
        : depMin <= 5
          ? `<span style="color:var(--yellow);font-size:.75rem">in ${depMin} Min.</span>`
          : `<span style="color:var(--text-muted);font-size:.75rem">in ${depMin} Min.</span>`;

      return `
        <div class="journey ${isNext ? 'next-departure' : ''}" onclick="openJourneyModal(${i})">
          ${isNext ? '<span class="next-badge">Nächste</span>' : ''}
          <div class="journey-time-row">
            <span class="journey-dep">${depStr}</span>${depDelay}
            <span class="journey-arrow">→</span>
            <span class="journey-arr">${arrStr}</span>${arrDelay}
          </div>
          <div class="journey-meta">
            ${inMin}
            <span class="journey-duration">· ${formatDuration(j.durationMin)}</span>
            ${j.changes > 0 ? `<span>· ${j.changes}× umsteigen</span>` : ''}
            <span style="display:flex;gap:4px;flex-wrap:wrap">${legBadges}</span>
          </div>
        </div>`;
    }).join('');

    const dots = journeys.map((_, i) =>
      `<div class="slider-dot${i === 0 ? ' active' : ''}"></div>`
    ).join('');

    content.innerHTML = `
      <div class="journey-slider" id="journey-slider">${slides}</div>
      <div class="slider-dots" id="slider-dots">${dots}</div>
      <div class="last-updated">Aktualisiert: ${new Date().toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit'})}</div>`;

    const slider = document.getElementById('journey-slider');
    const dotEls = document.querySelectorAll('#slider-dots .slider-dot');
    slider.addEventListener('scroll', () => {
      const cardWidth = (slider.firstElementChild?.offsetWidth || 0) + 12;
      const idx = Math.min(Math.round(slider.scrollLeft / cardWidth), journeys.length - 1);
      dotEls.forEach((d, i) => d.classList.toggle('active', i === idx));
    }, { passive: true });

  } catch (err) {
    content.innerHTML = `<div class="error-state">Fehler beim Laden: ${err.message}</div>`;
  } finally {
    btn.classList.remove('spinning');
  }
}

function openJourneyModal(i) {
  const j = _journeys[i];
  if (!j) return;

  const depDelay = j.depDelay > 0 ? ` <span class="delay">+${Math.round(j.depDelay)}'</span>` : '';
  const arrDelay = j.arrDelay > 0 ? ` <span class="delay">+${Math.round(j.arrDelay)}'</span>` : '';

  const legItems = j.legs.map((l, li) => {
    const isLast   = li === j.legs.length - 1;
    const lDep     = l.depDelay > 0 ? ` <span class="delay">+${Math.round(l.depDelay)}'</span>` : '';
    const lArr     = l.arrDelay > 0 ? ` <span class="delay">+${Math.round(l.arrDelay)}'</span>` : '';
    const dirLabel = l.direction ? `<span class="journey-leg-direction">→ ${l.direction}</span>` : '';

    return `
      <div class="journey-leg">
        <div class="journey-leg-line">
          <div class="journey-leg-dot"></div>
          <div class="journey-leg-connector"></div>
        </div>
        <div class="journey-leg-body">
          <div class="journey-leg-stop">${l.fromStop || '–'}</div>
          <div class="journey-leg-time">${fmtTime(l.depTime)}${lDep}</div>
          <div class="journey-leg-badge-row">
            <span class="line-badge ${lineBadgeClass(l.mode)}">${l.name}</span>
            ${dirLabel}
          </div>
        </div>
      </div>
      ${isLast ? `
      <div class="journey-leg">
        <div class="journey-leg-line">
          <div class="journey-leg-dot last"></div>
        </div>
        <div class="journey-leg-body">
          <div class="journey-leg-stop">${l.toStop || '–'}</div>
          <div class="journey-leg-time">${fmtTime(l.arrTime)}${lArr}</div>
        </div>
      </div>` : ''}`;
  }).join('');

  document.getElementById('journey-modal-body').innerHTML = `
    <div class="journey-modal-header">
      <div>
        <div class="journey-modal-times">${fmtTime(j.departure)}${depDelay} → ${fmtTime(j.arrival)}${arrDelay}</div>
        <div class="journey-modal-meta">${formatDuration(j.durationMin)}${j.changes > 0 ? ` · ${j.changes}× umsteigen` : ''}</div>
      </div>
      <button class="journey-modal-close" onclick="closeJourneyModal()">✕</button>
    </div>
    <div class="journey-legs">${legItems}</div>`;

  document.getElementById('journey-modal-overlay').classList.remove('hidden');
}

function closeJourneyModal(e) {
  if (e && e.target !== document.getElementById('journey-modal-overlay')) return;
  document.getElementById('journey-modal-overlay').classList.add('hidden');
}

// ── Kalender ──────────────────────────────────────────
function groupByDay(events) {
  const groups = {};
  for (const ev of events) {
    const d   = new Date(ev.start);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!groups[key]) groups[key] = { date: d, events: [] };
    groups[key].events.push(ev);
  }
  return Object.values(groups).sort((a,b) => a.date - b.date);
}

function dayLabel(date) {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d     = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff  = Math.round((d - today) / 86400000);

  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  if (diff === 2) return 'Übermorgen';
  return `${DE_DAYS[date.getDay()]}, ${date.getDate()}. ${DE_MONTHS[date.getMonth()]}`;
}

async function loadCalendar() {
  const btn     = document.querySelector('#calendar-card .refresh-btn');
  const content = document.getElementById('calendar-content');

  btn.classList.add('spinning');
  content.innerHTML = '<div class="loading-state">Lädt…</div>';

  try {
    const res    = await fetch('/api/calendar');
    const events = await res.json();

    if (!res.ok) throw new Error(events.error || 'Unbekannter Fehler');

    if (events.length === 0) {
      content.innerHTML = '<div class="empty-state">Keine Termine in den nächsten 14 Tagen.</div>';
      return;
    }

    const groups = groupByDay(events);
    const html = `
      <div class="event-list">
        ${groups.map(g => `
          <div class="event-day-group">
            <div class="event-day-label">${dayLabel(g.date)}</div>
            ${g.events.map(ev => {
              const isAllDay = ev.allDay;
              const timeStr  = isAllDay
                ? 'Ganztägig'
                : `${fmtTime(ev.start)} – ${fmtTime(ev.end)}`;
              return `
                <div class="event-item">
                  <div class="event-color-dot" style="background:${ev.calColor || '#4a90e2'}"></div>
                  <div class="event-info">
                    <div class="event-title">${ev.title}</div>
                    <div class="event-time">${timeStr}</div>
                    ${ev.location ? `<div class="event-location">📍 ${ev.location}</div>` : ''}
                  </div>
                </div>`;
            }).join('')}
          </div>`).join('')}
        <div class="last-updated">Aktualisiert: ${new Date().toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit'})}</div>
      </div>`;

    content.innerHTML = html;
  } catch (err) {
    content.innerHTML = `<div class="error-state">Fehler beim Laden: ${err.message}<br><small>Bitte .env-Datei prüfen (ICLOUD_EMAIL, ICLOUD_APP_PASSWORD)</small></div>`;
  } finally {
    btn.classList.remove('spinning');
  }
}

// ── Linie 302 ─────────────────────────────────────────
async function loadLine302() {
  const btn     = document.querySelector('#line302-card .refresh-btn');
  const content = document.getElementById('line302-content');

  btn.classList.add('spinning');
  content.innerHTML = '<div class="loading-state">Lädt…</div>';

  try {
    const res  = await fetch('/api/line302');
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Unbekannter Fehler');

    const { directions } = data;

    if (!directions || directions.length === 0) {
      content.innerHTML = '<div class="empty-state">Keine Abfahrten der Linie 302 gefunden.</div>';
      return;
    }

    const cols = directions.map(dir => {
      const chips = dir.departures.map((dep) => {
        const time  = fmtTime(dep.when);
        const depMin = minutesUntil(dep.when);
        const delay  = dep.delay > 0
          ? `<span class="dep-delay">+${Math.round(dep.delay / 60)}'</span>` : '';
        const inMin  = depMin <= 0
          ? '<span class="dep-in-min">jetzt</span>'
          : `<span class="dep-in-min">${depMin} Min.</span>`;
        return `<span class="dep-chip">${time}${delay} ${inMin}</span>`;
      }).join('');

      // Richtungsname: letztes Wort hervorheben (meist Zielort)
      const parts = dir.direction.split(' ');
      const highlight = parts.pop();
      const prefix    = parts.join(' ');
      const label     = prefix
        ? `${prefix} <span>${highlight}</span>`
        : `<span>${highlight}</span>`;

      return `
        <div class="line302-dir">
          <div class="line302-dir-label">→ ${label}</div>
          <div class="line302-departures">${chips || '<span style="color:var(--text-muted);font-size:.8rem">Keine Abfahrten</span>'}</div>
        </div>`;
    }).join('');

    content.innerHTML = `
      <div class="line302-grid">${cols}</div>
      <div class="last-updated">Aktualisiert: ${new Date().toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit'})}</div>`;

  } catch (err) {
    content.innerHTML = `<div class="error-state">Fehler: ${err.message}</div>`;
  } finally {
    btn.classList.remove('spinning');
  }
}

// ── Lichter ───────────────────────────────────────────
async function loadLights() {
  const btn     = document.querySelector('#lights-card .refresh-btn');
  const content = document.getElementById('lights-content');

  btn.classList.add('spinning');
  content.innerHTML = '<div class="loading-state">Lädt…</div>';

  try {
    const res     = await fetch('/api/lights');
    const devices = await res.json();

    if (!res.ok) throw new Error(devices.error || 'Unbekannter Fehler');

    if (!devices.length) {
      content.innerHTML = '<div class="empty-state">Keine Geräte gefunden.<br><small>Bitte LEDVANCE-Konto im Tuya-Portal verknüpfen.</small></div>';
      return;
    }

    content.innerHTML = `
      <div class="lights-list">
        ${devices.map(d => `
          <div class="light-row">
            <span class="light-name ${d.online ? '' : 'light-offline'}">${d.name}${d.online ? '' : ' <small>(offline)</small>'}</span>
            <button
              class="light-toggle ${d.on ? 'on' : 'off'}"
              onclick="toggleLight('${d.id}', ${!d.on}, this)"
              ${d.online ? '' : 'disabled'}
            >${d.on ? 'An' : 'Aus'}</button>
          </div>`).join('')}
      </div>`;
  } catch (err) {
    content.innerHTML = `<div class="error-state">Fehler: ${err.message}</div>`;
  } finally {
    btn.classList.remove('spinning');
  }
}

async function toggleLight(id, on, btn) {
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const res  = await fetch(`/api/lights/${id}/command`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ on }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    btn.textContent = on ? 'An' : 'Aus';
    btn.className   = `light-toggle ${on ? 'on' : 'off'}`;
  } catch (err) {
    btn.textContent = 'Fehler';
    setTimeout(() => loadLights(), 2000);
  } finally {
    btn.disabled = false;
    btn.onclick  = () => toggleLight(id, !on, btn);
  }
}

// ── Auto-Refresh ──────────────────────────────────────
// ÖPNV: alle 2 Minuten
// Kalender: alle 10 Minuten
loadTransport();
loadLine302();
loadCalendar();
loadLights();


setInterval(loadTransport, 2 * 60 * 1000);
setInterval(loadLine302,   2 * 60 * 1000);
setInterval(loadCalendar, 10 * 60 * 1000);

// Mitternacht: Seite neu laden (Datum-Anzeige)
function scheduleReloadAtMidnight() {
  const now  = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  setTimeout(() => window.location.reload(), next - now);
}
scheduleReloadAtMidnight();
