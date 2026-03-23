# Flur-Dashboard

iPad-Dashboard mit ÖPNV-Verbindungen, iCloud-Kalender und "Handy finden".

## Schnellstart

```bash
cd /Users/pepo/Documents/Dashboard
npm install
cp .env.example .env
# .env mit deinen Daten ausfüllen (s.u.)
npm start
```

Dann auf dem iPad im Safari öffnen: `http://[IP-deines-Macs]:3000`
(Dein Mac und das iPad müssen im gleichen WLAN sein.)

---

## .env konfigurieren

```env
ICLOUD_EMAIL=deine@icloud.com
ICLOUD_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
PORT=3000
RING_MODE=findmy
```

### App-spezifisches Passwort erstellen
1. https://appleid.apple.com → Anmelden
2. Sicherheit → App-spezifische Passwörter → „+"
3. Namen eingeben (z.B. „Dashboard") → Passwort kopieren

---

## Handy klingeln lassen – zwei Modi

### Modus 1: `RING_MODE=findmy` (automatisch)
Nutzt die iCloud Find My API direkt. Funktioniert ohne 2FA-Prompt wenn du das Gerät bereits als vertrauenswürdig markiert hast.

### Modus 2: `RING_MODE=webhook` (zuverlässiger mit 2FA)
Das Dashboard setzt ein Flag. Ein iPhone-Shortcut pollt alle 60 Sekunden und klingelt wenn das Flag gesetzt ist.

**Shortcut auf dem iPhone einrichten:**
1. Kurzbefehle-App öffnen → „Automation" → „+" → „Persönliche Automation"
2. Auslöser: „Zeit der Uhrzeit" → Alle 1 Minute (oder „Wenn geöffnet" → beliebige App)
3. Aktion 1: „URL-Inhalt abrufen" → URL: `http://[MAC-IP]:3000/api/ring-status`
4. Aktion 2: „Wenn" → `ring` ist `wahr`
5. Aktion 3 (im Wenn-Zweig): „Ton abspielen" oder „Alarm" → Ton deiner Wahl
6. Optional: Weitere URL abrufen zum Zurücksetzen (passiert automatisch)

---

## iPad als dauerhaften Kiosk einrichten

1. **Safari** → Teilen → „Zum Home-Bildschirm" → Dashboard als App speichern
2. **Einstellungen** → Bedienungshilfen → Geführter Zugriff → Einschalten
3. Dashboard-App öffnen → 3× Seitentaste → Geführten Zugriff starten

So bleibt das iPad dauerhaft auf dem Dashboard.

---

## Autostart auf dem Mac

Damit der Server nach einem Neustart automatisch startet:

```bash
# LaunchAgent erstellen
cat > ~/Library/LaunchAgents/com.dashboard.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.dashboard</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/pepo/Documents/Dashboard/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/pepo/Documents/Dashboard</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/dashboard.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/dashboard-error.log</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.dashboard.plist
```
