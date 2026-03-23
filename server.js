require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const { DAVClient } = require('tsdav');
const ICAL = require('ical.js');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// ============================================================
// ÖPNV – Deutsche Bahn REST API (kostenlos, kein Key nötig)
// ============================================================
const FROM_ADDRESS = 'Schlachthofstraße 43, 44866 Bochum';
const TO_ADDRESS   = 'Iltisstraße 38, 42285 Wuppertal';

// Locations einmalig cachen
let locationCache = {};

async function resolveLocation(address) {
  if (locationCache[address]) return locationCache[address];

  const url = `https://v6.db.transport.rest/locations?query=${encodeURIComponent(address)}&results=1&language=de`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });

  if (!res.ok) throw new Error(`DB API Fehler: ${res.status}`);
  const data = await res.json();
  if (!data || data.length === 0) throw new Error(`Ort nicht gefunden: ${address}`);

  const loc = data[0];
  locationCache[address] = loc;
  return loc;
}

app.get('/api/transport', async (req, res) => {
  try {
    const [from, to] = await Promise.all([
      resolveLocation(FROM_ADDRESS),
      resolveLocation(TO_ADDRESS)
    ]);

    const fromParam = from.id || `${from.location?.latitude},${from.location?.longitude}`;
    const toParam   = to.id   || `${to.location?.latitude},${to.location?.longitude}`;

    const now = new Date().toISOString();
    const journeyUrl = `https://v6.db.transport.rest/journeys?from=${encodeURIComponent(fromParam)}&to=${encodeURIComponent(toParam)}&results=10&departure=${encodeURIComponent(now)}&language=de&stopovers=false`;

    const journeyRes = await fetch(journeyUrl, { headers: { 'Accept': 'application/json' } });
    if (!journeyRes.ok) throw new Error(`Verbindungen-Fehler: ${journeyRes.status}`);
    const journeyData = await journeyRes.json();

    const journeys = (journeyData.journeys || []).map(j => {
      const firstLeg = j.legs[0];
      const lastLeg  = j.legs[j.legs.length - 1];

      const departure      = firstLeg.plannedDeparture || firstLeg.departure;
      const depDelay       = firstLeg.departureDelay ?? 0;
      const arrival        = lastLeg.plannedArrival   || lastLeg.arrival;
      const arrDelay       = lastLeg.arrivalDelay     ?? 0;
      const durationMs     = new Date(arrival) - new Date(departure);
      const durationMin    = Math.round(durationMs / 60000);

      const legs = j.legs
        .filter(l => l.line)
        .map(l => ({
          name:      l.line?.name || l.line?.fahrtNr || '?',
          mode:      l.line?.product || l.mode,
          direction: l.direction || '',
          fromStop:  l.origin?.name      || '',
          toStop:    l.destination?.name || '',
          depTime:   l.plannedDeparture  || l.departure,
          arrTime:   l.plannedArrival    || l.arrival,
          depDelay:  Math.max(0, (l.departureDelay ?? 0) / 60),
          arrDelay:  Math.max(0, (l.arrivalDelay   ?? 0) / 60),
        }));

      return {
        departure,
        depDelay: Math.max(0, depDelay / 60),
        arrival,
        arrDelay: Math.max(0, arrDelay / 60),
        durationMin,
        changes: j.legs.filter(l => l.line).length - 1,
        legs,
      };
    });

    res.json({ journeys, from: from.name, to: to.name });
  } catch (err) {
    console.error('[Transport]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Linie 302 – Abfahrten in beide Richtungen
// ============================================================
const LINE302_STOP_NAME = 'Lohrheidestraße';
let line302StopId = null; // wird einmalig ermittelt und gecacht

async function findLine302Stop() {
  if (line302StopId) return line302StopId;

  const url = `https://v6.db.transport.rest/locations?query=${encodeURIComponent(LINE302_STOP_NAME)}&results=5&stops=true&language=de`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Haltestellensuche fehlgeschlagen: ${res.status}`);
  const locations = await res.json();

  const stop = locations.find(l => l.type === 'stop' || l.type === 'station');
  if (!stop) throw new Error(`Haltestelle „${LINE302_STOP_NAME}" nicht gefunden`);

  line302StopId = stop.id;
  console.log(`[302] Haltestelle: ${stop.name} (${stop.id})`);
  return line302StopId;
}

app.get('/api/line302', async (req, res) => {
  try {
    const stopId = await findLine302Stop();

    const depUrl = `https://v6.db.transport.rest/stops/${stopId}/departures?results=30&duration=90&language=de`;
    const depRes = await fetch(depUrl, { headers: { 'Accept': 'application/json' } });
    if (!depRes.ok) throw new Error(`Abfahrten-Fehler: ${depRes.status}`);
    const depData = await depRes.json();
    const all = (depData.departures || depData).filter(
      d => d.line?.name === '302' || d.line?.id?.includes('302')
    );

    // In zwei Richtungsgruppen aufteilen
    const groups = {};
    for (const dep of all) {
      const dir = dep.direction || 'Unbekannt';
      if (!groups[dir]) groups[dir] = [];
      groups[dir].push({
        when:      dep.plannedWhen || dep.when,
        delay:     dep.delay ?? 0,
        direction: dir,
        platform:  dep.platform || dep.plannedPlatform || null,
      });
    }

    // Maximal 5 Abfahrten pro Richtung
    const directions = Object.entries(groups).map(([dir, deps]) => ({
      direction: dir,
      departures: deps.slice(0, 5),
    }));

    res.json({ stopId, directions });
  } catch (err) {
    console.error('[Line302]', err.message);
    // Stop-Cache zurücksetzen damit nächster Aufruf neu sucht
    line302StopId = null;
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// iCloud Kalender – CalDAV
// ============================================================
let davClient = null;

async function getDavClient() {
  if (!process.env.ICLOUD_EMAIL || !process.env.ICLOUD_APP_PASSWORD) {
    throw new Error('ICLOUD_EMAIL oder ICLOUD_APP_PASSWORD nicht konfiguriert');
  }

  if (!davClient) {
    davClient = new DAVClient({
      serverUrl: 'https://caldav.icloud.com',
      credentials: {
        username: process.env.ICLOUD_EMAIL,
        password: process.env.ICLOUD_APP_PASSWORD,
      },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });
    await davClient.login();
  }
  return davClient;
}

app.get('/api/calendar', async (req, res) => {
  try {
    const client = await getDavClient();
    const calendars = await client.fetchCalendars();

    const now     = new Date();
    const weekEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    let events = [];

    for (const calendar of calendars) {
      let objects;
      try {
        objects = await client.fetchCalendarObjects({
          calendar,
          timeRange: { start: now.toISOString(), end: weekEnd.toISOString() },
        });
      } catch {
        continue; // Kalender überspringen wenn Fehler
      }

      for (const obj of objects) {
        try {
          const jcal   = ICAL.parse(obj.data);
          const comp   = new ICAL.Component(jcal);
          const vevents = comp.getAllSubcomponents('vevent');

          for (const vevent of vevents) {
            const ev = new ICAL.Event(vevent);
            const start = ev.startDate.toJSDate();
            const end   = ev.endDate.toJSDate();

            if (start >= now || end >= now) {
              events.push({
                uid:         ev.uid,
                title:       ev.summary   || '(kein Titel)',
                start:       start.toISOString(),
                end:         end.toISOString(),
                allDay:      ev.startDate.isDate,
                location:    ev.location  || '',
                calendar:    calendar.displayName || '',
                calColor:    calendar.calendarColor || '#4a90e2',
              });
            }
          }
        } catch { /* ungültiges Event überspringen */ }
      }
    }

    events.sort((a, b) => new Date(a.start) - new Date(b.start));
    res.json(events.slice(0, 15));
  } catch (err) {
    console.error('[Calendar]', err.message);
    davClient = null; // Session zurücksetzen
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Tuya – LEDVANCE Smart+ WiFi Lichter
// ============================================================
const TUYA_BASE = process.env.TUYA_BASE_URL || 'https://openapi.tuyaeu.com';
const TUYA_ID   = process.env.TUYA_CLIENT_ID;
const TUYA_KEY  = process.env.TUYA_CLIENT_SECRET;

let tuyaToken    = null;
let tuyaTokenExp = 0;

function tuyaSign(clientId, secret, accessToken, t, nonce, method, urlPath, body) {
  const bodyHash     = crypto.createHash('sha256').update(body || '').digest('hex');
  const stringToSign = [method.toUpperCase(), bodyHash, '', urlPath].join('\n');
  const signContent  = clientId + (accessToken || '') + t + nonce + stringToSign;
  return crypto.createHmac('sha256', secret).update(signContent).digest('hex').toUpperCase();
}

async function tuyaFetch(method, urlPath, body) {
  if (!TUYA_ID || !TUYA_KEY) throw new Error('TUYA_CLIENT_ID oder TUYA_CLIENT_SECRET fehlen in .env');
  const isTokenReq = urlPath.startsWith('/v1.0/token');
  const token      = isTokenReq ? '' : await getTuyaToken();
  const t          = Date.now().toString();
  const nonce      = crypto.randomUUID();
  const bodyStr    = body ? JSON.stringify(body) : '';
  const sign       = tuyaSign(TUYA_ID, TUYA_KEY, token, t, nonce, method, urlPath, bodyStr);

  const headers = {
    'client_id':   TUYA_ID,
    'sign':        sign,
    'sign_method': 'HMAC-SHA256',
    't':           t,
    'nonce':       nonce,
  };
  if (token)   headers['access_token'] = token;
  if (bodyStr) headers['Content-Type'] = 'application/json';

  const res  = await fetch(`${TUYA_BASE}${urlPath}`, { method, headers, body: bodyStr || undefined });
  const data = await res.json();
  if (!data.success) throw new Error(data.msg || `Tuya Code ${data.code}`);
  return data.result;
}

async function getTuyaToken() {
  if (tuyaToken && Date.now() < tuyaTokenExp) return tuyaToken;
  const result = await tuyaFetch('GET', '/v1.0/token?grant_type=1');
  tuyaToken    = result.access_token;
  tuyaTokenExp = Date.now() + result.expire_time * 1000 - 60000;
  return tuyaToken;
}

// Geräteliste
app.get('/api/lights', async (req, res) => {
  try {
    const result  = await tuyaFetch('GET', '/v1.0/devices?page_no=1&page_size=20');
    const list    = Array.isArray(result) ? result : (result.list || result.devices || []);
    const devices = list.map(d => ({
      id:     d.id,
      name:   d.name,
      online: d.online,
      on:     d.status?.find(s => s.code === 'switch_led' || s.code === 'switch')?.value ?? false,
    }));
    res.json(devices);
  } catch (err) {
    console.error('[Lights]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Licht ein-/ausschalten
app.post('/api/lights/:id/command', async (req, res) => {
  const { id } = req.params;
  const { on }  = req.body;
  try {
    await tuyaFetch('POST', `/v1.0/devices/${id}/commands`, {
      commands: [{ code: 'switch_led', value: on }],
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[Lights command]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Server starten
// ============================================================
app.listen(PORT, () => {
  console.log(`\n🏠 Dashboard läuft auf http://localhost:${PORT}\n`);
  console.log(`   ÖPNV:    ${FROM_ADDRESS}`);
  console.log(`         → ${TO_ADDRESS}`);
  console.log(`   Kalender: ${process.env.ICLOUD_EMAIL ? '✓ konfiguriert' : '✗ nicht konfiguriert (.env)'}`);
  console.log(`   Ring-Modus: ${process.env.RING_MODE || 'findmy'}\n`);
});
