/* ===================================================
   Dashboard – Frontend Logic (ES5, Chrome 38+)
   =================================================== */

var DE_DAYS   = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
var DE_MONTHS = ['Januar','Februar','M\u00e4rz','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

// ── Uhr ──────────────────────────────────────────────
function updateClock() {
  var now  = new Date();
  var hh   = pad2(now.getHours());
  var mm   = pad2(now.getMinutes());
  document.getElementById('clock').textContent = hh + ':' + mm;
  document.getElementById('date-display').textContent =
    DE_DAYS[now.getDay()] + ', ' + now.getDate() + '. ' + DE_MONTHS[now.getMonth()] + ' ' + now.getFullYear();
}

setInterval(updateClock, 1000);
updateClock();

// ── Hilfsfunktionen ──────────────────────────────────
function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

function fmtTime(iso) {
  if (!iso) return '\u2013';
  var d = new Date(iso);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function formatDuration(min) {
  if (min < 60) return min + ' Min.';
  return Math.floor(min / 60) + 'h ' + (min % 60) + 'Min.';
}

function minutesUntil(iso) {
  return Math.round((new Date(iso) - Date.now()) / 60000);
}

function lineBadgeClass(mode) {
  var m = (mode || '').toLowerCase();
  if (m === 'bus') return 'bus';
  if (m === 'tram' || m === 'strassenbahn') return 'tram';
  if (m === 'subway' || m === 'u-bahn') return 'ubahn';
  if (m === 'suburban' || m === 's-bahn') return 'sbahn';
  return '';
}

// ── HTTP-Helfer (XHR statt fetch) ────────────────────
function httpGet(url) {
  return new Promise(function(resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.onload = function() {
      var data;
      try { data = JSON.parse(xhr.responseText); } catch(e) { return reject(e); }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error((data && data.error) || ('HTTP ' + xhr.status)));
    };
    xhr.onerror = function() { reject(new Error('Netzwerkfehler')); };
    xhr.send();
  });
}

function httpPost(url, body) {
  return new Promise(function(resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function() {
      var data;
      try { data = JSON.parse(xhr.responseText); } catch(e) { return reject(e); }
      resolve(data);
    };
    xhr.onerror = function() { reject(new Error('Netzwerkfehler')); };
    xhr.send(JSON.stringify(body || {}));
  });
}

// ── ÖPNV ─────────────────────────────────────────────
var _journeys = [];

function loadTransport() {
  var btn     = document.querySelector('#transport-card .refresh-btn');
  var content = document.getElementById('transport-content');
  btn.classList.add('spinning');
  content.innerHTML = '<div class="loading-state">L\u00e4dt\u2026</div>';

  httpGet('/api/transport').then(function(data) {
    var journeys = data.journeys || [];
    _journeys = journeys;

    if (!journeys.length) {
      content.innerHTML = '<div class="empty-state">Keine Verbindungen gefunden.</div>';
      btn.classList.remove('spinning');
      return;
    }

    var slides = '';
    for (var i = 0; i < journeys.length; i++) {
      var j       = journeys[i];
      var depMin  = minutesUntil(j.departure);
      var isNext  = i === 0;
      var badges  = '';
      for (var li = 0; li < j.legs.length; li++) {
        badges += '<span class="line-badge ' + lineBadgeClass(j.legs[li].mode) + '">' + j.legs[li].name + '</span>';
      }
      var depDelay = j.depDelay > 0 ? '<span class="delay">+' + Math.round(j.depDelay) + '\'</span>' : '';
      var arrDelay = j.arrDelay > 0 ? '<span class="delay" style="font-size:.65rem">+' + Math.round(j.arrDelay) + '\'</span>' : '';
      var inMin;
      if (depMin <= 0)      inMin = '<span style="color:#f85149;font-size:.75rem">Jetzt</span>';
      else if (depMin <= 5) inMin = '<span style="color:#d29922;font-size:.75rem">in ' + depMin + ' Min.</span>';
      else                  inMin = '<span style="color:#8b949e;font-size:.75rem">in ' + depMin + ' Min.</span>';

      slides += '<div class="journey' + (isNext ? ' next-departure' : '') + '" onclick="openJourneyModal(' + i + ')">'
        + (isNext ? '<span class="next-badge">N\u00e4chste</span>' : '')
        + '<div class="journey-time-row">'
        + '<span class="journey-dep">' + fmtTime(j.departure) + '</span>' + depDelay
        + '<span class="journey-arrow">\u2192</span>'
        + '<span class="journey-arr">' + fmtTime(j.arrival) + '</span>' + arrDelay
        + '</div>'
        + '<div class="journey-meta">'
        + inMin
        + '<span class="journey-duration">\u00b7 ' + formatDuration(j.durationMin) + '</span>'
        + (j.changes > 0 ? '<span>\u00b7 ' + j.changes + '\u00d7 umsteigen</span>' : '')
        + '<span style="display:-webkit-flex;display:flex;gap:4px;-webkit-flex-wrap:wrap;flex-wrap:wrap">' + badges + '</span>'
        + '</div>'
        + '</div>';
    }

    var dots = '';
    for (var di = 0; di < journeys.length; di++) {
      dots += '<div class="slider-dot' + (di === 0 ? ' active' : '') + '"></div>';
    }

    content.innerHTML = '<div class="journey-slider" id="journey-slider">' + slides + '</div>'
      + '<div class="slider-dots" id="slider-dots">' + dots + '</div>'
      + '<div class="last-updated">Aktualisiert: '
      + new Date().toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})
      + '</div>';

    var slider = document.getElementById('journey-slider');
    var dotEls = document.querySelectorAll('#slider-dots .slider-dot');
    slider.addEventListener('scroll', function() {
      var cardWidth = (slider.firstElementChild ? slider.firstElementChild.offsetWidth : 0) + 12;
      var idx = Math.min(Math.round(slider.scrollLeft / cardWidth), journeys.length - 1);
      for (var k = 0; k < dotEls.length; k++) {
        if (k === idx) dotEls[k].classList.add('active');
        else           dotEls[k].classList.remove('active');
      }
    });

    btn.classList.remove('spinning');
  }).catch(function(err) {
    content.innerHTML = '<div class="error-state">Fehler beim Laden: ' + err.message + '</div>';
    btn.classList.remove('spinning');
  });
}

function openJourneyModal(i) {
  var j = _journeys[i];
  if (!j) return;

  var depDelay = j.depDelay > 0 ? ' <span class="delay">+' + Math.round(j.depDelay) + '\'</span>' : '';
  var arrDelay = j.arrDelay > 0 ? ' <span class="delay">+' + Math.round(j.arrDelay) + '\'</span>' : '';

  var legItems = '';
  for (var li = 0; li < j.legs.length; li++) {
    var l           = j.legs[li];
    var isLast      = li === j.legs.length - 1;
    var nextLeg     = j.legs[li + 1];
    var lDep        = l.depDelay > 0 ? ' <span class="delay">+' + Math.round(l.depDelay) + '\'</span>' : '';
    var lArr        = l.arrDelay > 0 ? ' <span class="delay">+' + Math.round(l.arrDelay) + '\'</span>' : '';
    var dirLabel    = l.direction ? '<span class="journey-leg-direction">\u2192 ' + l.direction + '</span>' : '';
    var transferMin = (!isLast && nextLeg)
      ? Math.round((new Date(nextLeg.depTime) - new Date(l.arrTime)) / 60000) : 0;

    legItems += '<div class="journey-leg">'
      + '<div class="journey-leg-line"><div class="journey-leg-dot"></div><div class="journey-leg-connector"></div></div>'
      + '<div class="journey-leg-body">'
      + '<div class="journey-leg-stop">' + (l.fromStop || '\u2013') + '</div>'
      + '<div class="journey-leg-time">' + fmtTime(l.depTime) + lDep + '</div>'
      + '<div class="journey-leg-badge-row">'
      + '<span class="line-badge ' + lineBadgeClass(l.mode) + '">' + l.name + '</span>'
      + dirLabel + '</div>'
      + '</div></div>'
      + '<div class="journey-leg">'
      + '<div class="journey-leg-line">'
      + '<div class="journey-leg-dot ' + (isLast ? 'last' : 'transfer') + '"></div>'
      + (!isLast ? '<div class="journey-leg-connector dashed"></div>' : '')
      + '</div>'
      + '<div class="journey-leg-body">'
      + '<div class="journey-leg-stop">' + (l.toStop || '\u2013') + '</div>'
      + '<div class="journey-leg-time">' + fmtTime(l.arrTime) + lArr + '</div>'
      + (!isLast ? '<div class="transfer-chip">\u23f1 ' + transferMin + ' Min. Umsteigen</div>' : '')
      + '</div></div>';
  }

  document.getElementById('journey-modal-body').innerHTML =
    '<div class="journey-modal-header">'
    + '<div>'
    + '<div class="journey-modal-times">' + fmtTime(j.departure) + depDelay + ' \u2192 ' + fmtTime(j.arrival) + arrDelay + '</div>'
    + '<div class="journey-modal-meta">' + formatDuration(j.durationMin) + (j.changes > 0 ? ' \u00b7 ' + j.changes + '\u00d7 umsteigen' : '') + '</div>'
    + '</div>'
    + '<button class="journey-modal-close" onclick="closeJourneyModal()">\u2715</button>'
    + '</div>'
    + '<div class="journey-legs">' + legItems + '</div>';

  document.getElementById('journey-modal-overlay').classList.remove('hidden');
}

function closeJourneyModal(e) {
  if (e && e.target !== document.getElementById('journey-modal-overlay')) return;
  document.getElementById('journey-modal-overlay').classList.add('hidden');
}

// ── Linie 302 ─────────────────────────────────────────
function loadLine302() {
  var btn     = document.querySelector('#line302-card .refresh-btn');
  var content = document.getElementById('line302-content');
  btn.classList.add('spinning');
  content.innerHTML = '<div class="loading-state">L\u00e4dt\u2026</div>';

  httpGet('/api/line302').then(function(data) {
    var directions = data.directions;
    if (!directions || !directions.length) {
      content.innerHTML = '<div class="empty-state">Keine Abfahrten der Linie 302 gefunden.</div>';
      btn.classList.remove('spinning');
      return;
    }

    var cols = '';
    for (var di = 0; di < directions.length; di++) {
      var dir   = directions[di];
      var chips = '';
      for (var ci = 0; ci < dir.departures.length; ci++) {
        var dep    = dir.departures[ci];
        var depMin = minutesUntil(dep.when);
        var delay  = dep.delay > 0 ? '<span class="dep-delay">+' + Math.round(dep.delay / 60) + '\'</span>' : '';
        var inMin  = depMin <= 0
          ? '<span class="dep-in-min">jetzt</span>'
          : '<span class="dep-in-min">' + depMin + ' Min.</span>';
        chips += '<span class="dep-chip">' + fmtTime(dep.when) + delay + ' ' + inMin + '</span>';
      }
      var parts     = dir.direction.split(' ');
      var highlight = parts.pop();
      var prefix    = parts.join(' ');
      var label     = prefix ? prefix + ' <span>' + highlight + '</span>' : '<span>' + highlight + '</span>';

      cols += '<div class="line302-dir">'
        + '<div class="line302-dir-label">\u2192 ' + label + '</div>'
        + '<div class="line302-departures">' + (chips || '<span style="color:#8b949e;font-size:.8rem">Keine Abfahrten</span>') + '</div>'
        + '</div>';
    }

    content.innerHTML = '<div class="line302-grid">' + cols + '</div>'
      + '<div class="last-updated">Aktualisiert: '
      + new Date().toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})
      + '</div>';
    btn.classList.remove('spinning');
  }).catch(function(err) {
    content.innerHTML = '<div class="error-state">Fehler: ' + err.message + '</div>';
    btn.classList.remove('spinning');
  });
}

// ── Lichter ───────────────────────────────────────────
function loadLights() {
  var btn     = document.querySelector('#lights-card .refresh-btn');
  var content = document.getElementById('lights-content');
  btn.classList.add('spinning');
  content.innerHTML = '<div class="loading-state">L\u00e4dt\u2026</div>';

  httpGet('/api/lights').then(function(devices) {
    if (!devices.length) {
      content.innerHTML = '<div class="empty-state">Keine Ger\u00e4te gefunden.<br><small>Bitte LEDVANCE-Konto im Tuya-Portal verkn\u00fcpfen.</small></div>';
      btn.classList.remove('spinning');
      return;
    }
    var rows = '';
    for (var i = 0; i < devices.length; i++) {
      var d = devices[i];
      rows += '<div class="light-row">'
        + '<span class="light-name' + (d.online ? '' : ' light-offline') + '">'
        + d.name + (d.online ? '' : ' <small>(offline)</small>') + '</span>'
        + '<button class="light-toggle ' + (d.on ? 'on' : 'off') + '"'
        + ' onclick="toggleLight(\'' + d.id + '\',' + (!d.on) + ',this)"'
        + (d.online ? '' : ' disabled')
        + '>' + (d.on ? 'An' : 'Aus') + '</button>'
        + '</div>';
    }
    content.innerHTML = '<div class="lights-list">' + rows + '</div>';
    btn.classList.remove('spinning');
  }).catch(function(err) {
    content.innerHTML = '<div class="error-state">Fehler: ' + err.message + '</div>';
    btn.classList.remove('spinning');
  });
}

function toggleLight(id, on, btn) {
  btn.disabled    = true;
  btn.textContent = '\u2026';
  httpPost('/api/lights/' + id + '/command', {on: on}).then(function(data) {
    if (!data.success) throw new Error(data.error);
    btn.textContent = on ? 'An' : 'Aus';
    btn.className   = 'light-toggle ' + (on ? 'on' : 'off');
    btn.disabled    = false;
    btn.onclick     = function() { toggleLight(id, !on, btn); };
  }).catch(function() {
    btn.textContent = 'Fehler';
    btn.disabled    = false;
    setTimeout(loadLights, 2000);
  });
}

// ── Schalke 04 ────────────────────────────────────────
var S04_MATCHES = [
  {date: '2026-04-05T13:30:00', opponent: 'Karlsruher SC',   home: true,  spieltag: 28},
  {date: '2026-04-12T13:30:00', opponent: 'SV Elversberg',   home: false, spieltag: 29},
  {date: '2026-04-19T13:30:00', opponent: 'Preu\u00dfen M\u00fcnster', home: true, spieltag: 30},
  {date: '2026-04-25T15:30:00', opponent: 'SC Paderborn 07', home: false, spieltag: 31}
];

function renderSchalke() {
  var now   = new Date();
  var match = null;
  for (var i = 0; i < S04_MATCHES.length; i++) {
    if (new Date(S04_MATCHES[i].date) > now) { match = S04_MATCHES[i]; break; }
  }
  var el = document.getElementById('schalke-content');
  if (!el) return;
  if (!match) {
    el.innerHTML = '<div class="empty-state">Keine weiteren Spiele hinterlegt.</div>';
    return;
  }
  var d        = new Date(match.date);
  var diffMs   = d - now;
  var diffDays = Math.floor(diffMs / 86400000);
  var diffH    = Math.floor((diffMs % 86400000) / 3600000);
  var diffM    = Math.floor((diffMs % 3600000) / 60000);
  var dateStr  = DE_DAYS[d.getDay()] + ', ' + d.getDate() + '. ' + DE_MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  var timeStr  = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ' Uhr';
  var countdown;
  if (diffDays > 0)    countdown = 'in ' + diffDays + ' Tag' + (diffDays !== 1 ? 'en' : '') + ' ' + diffH + 'h';
  else if (diffH > 0)  countdown = 'in ' + diffH + 'h ' + diffM + ' Min.';
  else                 countdown = 'in ' + diffM + ' Min.';

  el.innerHTML = '<div class="s04-match">'
    + '<div class="s04-badge">' + (match.home ? 'Heimspiel' : 'Ausw\u00e4rtsspiel') + ' \u00b7 ' + match.spieltag + '. Spieltag</div>'
    + '<div class="s04-opponent">'
    + '<span class="s04-club">FC Schalke 04</span>'
    + '<span class="s04-vs">' + (match.home ? 'vs.' : '@') + '</span>'
    + '<span class="s04-club">' + match.opponent + '</span>'
    + '</div>'
    + '<div class="s04-datetime">' + dateStr + ' \u00b7 ' + timeStr + '</div>'
    + '<div class="s04-countdown">' + countdown + '</div>'
    + '</div>';
}

function initSchalke() {
  renderSchalke();
  setInterval(renderSchalke, 60000);
}

// ── Auto-Refresh ──────────────────────────────────────
loadTransport();
loadLine302();
loadLights();
initSchalke();

setInterval(loadTransport, 2 * 60 * 1000);
setInterval(loadLine302,   2 * 60 * 1000);

// Mitternacht: Seite neu laden
function scheduleReloadAtMidnight() {
  var now  = new Date();
  var next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  setTimeout(function() { window.location.reload(); }, next - now);
}
scheduleReloadAtMidnight();
