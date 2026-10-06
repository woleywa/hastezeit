# Architektur – Bock

## 1. Analyse des bestehenden Projekts (`brocode`)

| Bereich | Befund |
|---|---|
| Tech-Stack | Reines **HTML + Vanilla JavaScript** (ES6: Arrow Functions, `let/const`, Array-Methoden, Closures) |
| Struktur | Flache Einzeldateien (`index.html` + `index.js`, `math.*`, `date.*`, `chains.*` …) – JavaScript-Lernübungen von 2022 |
| package.json / Dependencies | keine |
| Build / Dev-Setup | keins – Dateien direkt im Browser geöffnet |
| TypeScript | nein |
| Styling / UI | keins (unformatiertes HTML) |
| Routing, State, Backend, DB, Auth, PWA, Deployment, Env-Vars | nicht vorhanden |
| Wiederverwendbarer Code | keiner – das sind Übungsschnipsel, kein Spiel. Übernommen werden die **Patterns**: Vanilla JS, keine Build-Tools, DOM direkt per `innerHTML`/Events |

Die App ist aus dem Repo `brocode` (JavaScript-Übungen) heraus entstanden und lebt jetzt hier eigenständig.

> Hinweis: In diesem Workspace gab es kein Spiel. Ein weiteres Repo (`Unblock-it`) konnte in dieser Session nicht
> angehängt werden. Falls *das* das gemeinte Spiel ist, kann der Stack nachträglich angeglichen werden.

## 2. Gewählter Stack

| Schicht | Wahl | Warum |
|---|---|---|
| Frontend | **Vanilla JS (ES Modules) + CSS**, kein Framework, kein Build | Wie im bestehenden Projekt. Null Tooling, sofort lauffähig, für ~15 Screens völlig ausreichend |
| Templating | 30-Zeilen `html`-Tagged-Template mit Auto-Escaping (`public/js/ui.js`) | XSS-sicher ohne Framework |
| Routing | Hash-Router (`#/post/:id`) | Funktioniert auf jedem statischen Host und in Capacitor |
| Backend | **Node.js 22**, nur `node:http` – **0 npm-Dependencies** | Eine Sprache für alles, nichts zu updaten, nichts mit Lizenzrisiko |
| Datenbank | **SQLite** über Nodes eingebautes `node:sqlite` | Eine Datei, keine native Abhängigkeit, kein DB-Server. Für 20–100 Nutzer mehr als genug |
| Auth | Eigene: E-Mail + Passwort (scrypt), Session-Cookie (HttpOnly, SameSite=Lax), Registrierung nur per Invite-/Share-Link | Kein externer Dienst, DSGVO-freundlich |
| Realtime | Polling (30 s) + Refresh beim App-Fokus | WebSockets/SSE wären für 100 Leute Overengineering |
| PWA | Manifest + Service Worker (network-first, Offline-Fallback) | Installierbar auf iOS/Android ohne Store |
| Native später | **Capacitor** um dasselbe `public/` | Hash-Routing + relative API funktionieren unverändert |

**Abweichungen vom Vorbild:** keine – nur Ergänzungen (Server, DB, Auth), weil das Übungsprojekt dafür nichts hatte.
**Bewusst nicht gewählt:** Supabase (Vorgabe), Firebase/Clerk/Auth0 (BaaS-Lock-in, Kosten bei Wachstum),
PostgreSQL (zusätzlicher Server-Prozess ohne Nutzen bei <100 Nutzern; Migration später einfach, da SQL-Standard),
React/Next.js (Build-Toolchain ohne echten Mehrwert für diese Größe).

## 3. Grundarchitektur

```
public/            App-Shell (PWA): index.html, css/, js/views/*, sw.js
shared/            Reine Domain-Helfer, laufen in Browser UND Node:
                   constants · parse (NLP) · time (Zeitzonen) · format · emoji
server/
  app.js           HTTP-Routen → Services (keine Logik in den Routen)
  domain/          users · groups · posts (Teilnahme, Kommentare, Reminder) · interpret
  notifications/   notify() + Channels (in-app jetzt; Web Push / native / WhatsApp später)
  integrations/    whatsapp.js (offizielle Cloud API, standardmäßig aus)
  pages/           Server-gerenderte Share-/Invite-Seiten mit Open-Graph-Vorschau
  db.js            SQLite + versionierte Migrationen (PRAGMA user_version)
```

Datenmodell & Domain-Logik sind vollständig vom UI getrennt: Services bekommen `userId` + Eingabe und werfen `AppError`s;
HTTP-Schicht und UI kennen keine SQL-Details.

### Natural-Language-Input
Alle freien Texte laufen durch **eine** Schnittstelle: `interpret(text) → Draft` (`server/domain/interpret.js`).
Heute regelbasiert (`shared/parse.js`, läuft auch live im Formular: „Di 18-20 Tennis Tempelhof“ füllt Tag/Zeit/Ort).
Später kann dort ein LLM vorgeschaltet werden – Posts speichern `source` (`app|nlp|whatsapp`) und `raw_input`.

### Benachrichtigungen
Domain-Code ruft `notifications.notify({ userIds, type, postId, actorId })`. Jede Zeile in `notifications` ist die
In-App-Benachrichtigung; zusätzlich wird sie an registrierte **Channels** übergeben. Typen: `post_created`,
`participation`, `comment`, `suggestion`, `reminder` (60 min vorher, idempotent über `dedupe_key`).
Web Push: Tabelle `push_subscriptions` + VAPID-Channel ergänzen (Anleitung in `channels.js`), der Service Worker hat den
`push`-Handler bereits.

### WhatsApp
Ausgehend jetzt: „In WhatsApp teilen“ über den offiziellen `wa.me/?text=`-Link + Web Share API + Link kopieren.
Share-Links `/e/CODE` liefern eine schöne Vorschau (Open Graph) und „Bin dabei“ mit einem Tap.
Eingehend vorbereitet: Webhook `/api/integrations/whatsapp/webhook` (Signaturprüfung, Payload-Parsing) →
`handleInbound()` → `interpret()` → Post anlegen → Antwort mit Share-Link. Keine inoffiziellen Hacks.

## 4. Datenmodell (SQLite)

```
users(id, name, email, phone, password_hash, emoji, color, is_demo, created_at)
sessions(token_hash, user_id, created_at, expires_at)
friend_groups(id, name, emoji, invite_code, created_by, created_at)
group_members(group_id, user_id, role[admin|member], joined_at)
posts(id, type[availability|activity|help_request|help_offer], author_id, title, description, emoji,
      starts_at, ends_at, until_at, location, capacity, ideas(JSON), share_code,
      source[app|nlp|whatsapp], raw_input, created_at, updated_at, cancelled_at)
post_groups(post_id, group_id)                     -- n:m, ein Post kann in mehreren Gruppen sein
participants(post_id, user_id, status[going|maybe|declined|free|helping|accepting], …)
comments(id, post_id, user_id, kind[comment|suggestion], body, created_at)
notifications(id, user_id, type, post_id, actor_id, data(JSON), dedupe_key, created_at, read_at)
availability_slots(user_id, date, part[morning|afternoon|evening], created_at)   -- „Wann hast du Zeit?“
round_messages(id, group_id, date, part, user_id, body, created_at)              -- Chat einer Runde
```

Runden werden nicht gespeichert, sondern aus `availability_slots` berechnet (`shared/rounds.js`):
alle Mitglieder einer Gruppe mit demselben Tag + Tagesabschnitt, mindestens 2 Personen.

Sichtbarkeit: Ein Post ist sichtbar für Autor:in, Mitglieder mindestens einer seiner Gruppen und alle, die über
den Share-Link teilnehmen (der Share-Code ist bewusst eine „Capability“ – genau dafür wird er in WhatsApp geteilt).

## 5. Kosten

**Dauerhaft kostenlos (Open Source / eingebaut):** Node.js, SQLite, gesamter App-Code, Auth, PWA, Web Share,
`wa.me`-Links, (später) Web Push mit VAPID, Capacitor.

**Reale externe Kosten, die später entstehen können:**

| Posten | Grobe Kosten |
|---|---|
| Server/VPS (z. B. Hetzner CX22) | ca. 4–6 €/Monat – alternativ Raspberry Pi zu Hause: 0 € |
| Domain | ca. 1–15 €/Jahr |
| TLS-Zertifikat | 0 € (Let's Encrypt / Caddy) |
| Apple Developer Program (iOS-App im App Store) | 99 USD/Jahr |
| Google Play Developer | 25 USD einmalig |
| WhatsApp Business Platform | Nutzerinitiierte Antworten im 24-h-Fenster aktuell kostenlos; Template-/Marketing-Nachrichten kostenpflichtig pro Nachricht; Meta-Business-Verifizierung nötig. Preise ändern sich – vor Start prüfen |
| E-Mail (falls Passwort-Reset/Magic Links) | Eigener SMTP oder Free-Tier eines Anbieters |
| LLM für NL-Parsing (optional) | Pay-per-Use oder lokales Open-Source-Modell |
