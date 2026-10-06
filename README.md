# 🤙 Bock – Zeit mit Freunden

Private Social-Coordination-App für Freundeskreise. **WhatsApp = Kommunikation, Bock = Koordination des echten Lebens.**

**Der Kern:** Jede:r tippt an, wann er/sie diese Woche Zeit hat (Vormittag, Nachmittag, Abend – mehrmals pro Woche,
in Sekunden). Wer aus derselben Freundesgruppe zur gleichen Zeit kann, landet **automatisch in einer Runde** –
mit Chat, Ideen, 🎲 Würfel („Was machen wir, wer organisiert?“) und „Plan fixieren“.

Außerdem auf einen Blick:

- 🕐 **Wer hat wann Zeit?** – „Ich habe Dienstag 18–20 Uhr Zeit.“
- 🎯 **Wer hat worauf Bock?** – „Freitag 20 Uhr – Expertise Bar“
- 🤝 **Wer braucht oder bietet Hilfe?** – „Kann mir Samstag jemand beim Couchtragen helfen?“

Mobile-first PWA, privat (nur per Einladungslink), ohne Supabase und **ohne eine einzige npm-Dependency**.

## Schnellstart

Voraussetzung: **Node.js ≥ 22.13** (wegen des eingebauten `node:sqlite`).

```bash
cp .env.example .env     # optional – Defaults funktionieren
npm start                # http://localhost:3000
```

Beim ersten Start im Demo-Modus werden 8 Demo-Freunde, 3 Gruppen und ~12 Pläne angelegt.
Auf der Startseite einfach auf einen Namen tippen (z. B. **Wolfgang**) – fertig.

**Auf dem Smartphone testen:** Rechner und Handy im selben WLAN → `http://<IP-des-Rechners>:3000` öffnen.
Für „Zum Home-Bildschirm“ / Service Worker braucht das Handy HTTPS, z. B. per `npx localtunnel --port 3000`
oder `cloudflared tunnel --url http://localhost:3000`.

## Web-Demo ohne Server

`npm run build:demo` packt das echte Frontend in eine einzelne Seite und ersetzt die HTTP-API durch
`demo/api-demo.js` (gleiche Regeln, Daten im Browser des Besuchers). Damit lässt sich die UX auf jedem Handy
testen, ohne etwas zu installieren. Jede:r Besucher:in hat dabei eine eigene Demo-Welt.

### Web-Demo auf GitHub Pages

Der Workflow `.github/workflows/pages.yml` baut bei jedem Push auf `main` die Demo (`dist/site/`) und
veröffentlicht sie auf GitHub Pages. Einmalig nötig: **Settings → Pages → Source: „GitHub Actions“**.
Bei einem kostenlosen GitHub-Account muss das Repo dafür öffentlich sein. Adresse danach: `https://woleywa.github.io/hastezeit/`.

## Development

| Befehl | Zweck |
|---|---|
| `npm run dev` | Server mit Auto-Reload (`node --watch`) |
| `npm run seed` | Datenbank zurücksetzen und Demo-Daten neu anlegen |
| `npm test` | Parser-Unit-Tests + API-Integrationstests (`node:test`, In-Memory-DB) |
| `npm run build:demo` | Web-Demo als **eine** HTML-Datei bauen (`dist/bock-demo.html`, braucht `npm install` für esbuild) |

Frontend-Dateien (`public/`, `shared/`) werden direkt ausgeliefert – Browser neu laden genügt, kein Build.

Demo-Logins: `<name>@demo.bock.app` / `demo1234` (wolfgang, anna, max, lisa, jonas, sophie, can, mia).

## Architektur (Kurzfassung)

```
public/   PWA-Frontend: Vanilla JS ES-Modules, Hash-Router, eigenes html``-Templating, CSS-Design-System
shared/   Domain-Helfer für Browser + Server: Post-Typen, NLP-Parser, Zeitzonen, Formatierung
server/   node:http-Server: Routen (app.js) → Services (domain/) → SQLite (db.js)
          notifications/ (Channel-Abstraktion), integrations/whatsapp.js, pages/ (Share-Vorschau)
test/     node:test
```

Ausführlich – Stack-Analyse, Begründungen, Datenmodell, Kosten: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

### Wichtige Flows

- **Zeiten & Runden (Tab „Zeiten“):** 7-Tage-Raster × Vormittag/Nachmittag/Abend. Antippen = „da kann ich“.
  Die Zahl an einem Feld zeigt, wie viele Freunde dann schon können. Überschneidungen werden pro Freundesgruppe zu
  Runden (`shared/rounds.js`); kleinere Runden mit denselben Leuten (z. B. Tennis ⊂ Berlin Crew) werden zusammengefasst.

- **Post in < 20 s:** ＋ → Typ → (optional „Was?“) → **Posten**. Tag, Uhrzeit und Gruppen sind vorausgefüllt.
  Das „Was?“-Feld versteht Kurztext: `Di 18-20 Tennis Tempelhof` setzt Tag, Zeit, Ort und Titel automatisch.
- **Teilen:** Nach dem Posten erscheint direkt „In WhatsApp teilen“. Der Link `/e/CODE` zeigt in WhatsApp
  eine Vorschau („🍺 Expertise Bar · Freitag 20 Uhr · Wolfgang ist dabei“) und führt mit einem Tap zu „Bin dabei“ –
  auch für Leute ohne Konto (kurze Registrierung).
- **Einladen:** Gruppe → „Freunde einladen“ → Link `/i/CODE` → Name, E-Mail, Passwort → drin.

## Datenbank

SQLite-Datei unter `DATABASE_PATH` (Default `./data/bock.db`, WAL-Modus). Schema & Migrationen: `server/db.js`
(append-only Liste, Version in `PRAGMA user_version`). Backup = Datei kopieren, z. B. `sqlite3 bock.db ".backup b.db"`.

Entitäten: `users`, `sessions`, `friend_groups`, `group_members`, `posts` (Typen `availability`, `activity`,
`help_request`, `help_offer`), `post_groups`, `participants`, `comments`, `notifications`.

Migration zu PostgreSQL ist später möglich (Standard-SQL, alle Zugriffe gekapselt in `server/domain/*`) –
für 20–100 Nutzer aber nicht nötig.

## Deployment

Ein einzelner Node-Prozess + eine Datei. Beispiel VPS mit Docker:

```bash
docker build -t bock .
docker run -d --name bock -p 3000:3000 -v bock-data:/app/data \
  -e PUBLIC_URL=https://bock.example.de -e COOKIE_SECURE=true bock
```

Davor ein Reverse-Proxy mit automatischem TLS, z. B. **Caddy**:

```
bock.example.de {
    reverse_proxy localhost:3000
}
```

Ohne Docker: `npm start` per systemd-Service. Läuft auch auf einem Raspberry Pi.

**Native Apps später:** `public/` mit [Capacitor](https://capacitorjs.com) verpacken und die API-Basis-URL auf den
Server zeigen lassen; Push über einen zusätzlichen Notification-Channel (APNs/FCM).

## Environment Variables

| Variable | Default | Bedeutung |
|---|---|---|
| `PORT` | `3000` | HTTP-Port |
| `PUBLIC_URL` | (aus Host-Header) | Basis für Share-/Invite-Links und WhatsApp-Vorschau |
| `DATABASE_PATH` | `./data/bock.db` | SQLite-Datei |
| `APP_TZ` | `Europe/Berlin` | Zeitzone für Parser, Share-Seiten, Erinnerungen |
| `APP_NAME` | `Bock` | Name in UI und Share-Seiten |
| `DEMO_MODE` | `true` | Demo-Daten beim ersten Start + Demo-Login-Buttons. **In Produktion `false`** |
| `ALLOW_OPEN_SIGNUP` | `false` | Registrierung ohne Einladungslink erlauben |
| `COOKIE_SECURE` | `false` | Session-Cookie nur über HTTPS (hinter TLS auf `true`) |
| `WHATSAPP_ENABLED` | `false` | Offizieller WhatsApp-Cloud-API-Webhook (vorbereitet) |
| `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | – | Zugangsdaten aus dem Meta-Business-Konto |

## Verwendete Technologien

Node.js 22 (`node:http`, `node:sqlite`, `node:crypto`, `node:test`) · SQLite · Vanilla JavaScript (ES Modules) ·
CSS (Custom Properties, Dark Mode) · PWA (Web App Manifest, Service Worker) · Web Share API · WhatsApp-Click-to-Chat-Links.
Keine Frameworks, keine Build-Tools, keine Drittanbieter-Dienste.

## Bewusst (noch) nicht drin

Öffentlicher Feed, Follower, Gamification, eigenes Messaging, komplexer Kalender, Push-Infrastruktur,
Passwort-Reset per E-Mail (braucht SMTP), Bearbeiten von Posts (Absagen + neu posten geht).
