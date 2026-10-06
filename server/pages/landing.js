// Server-rendered landing pages for shared links. They exist so that WhatsApp/iMessage/Telegram
// show a rich preview (Open Graph tags) and so that people without the app instantly see what's up.
import { escapeHtml as e } from '../http.js';
import { spokenWhen, joinNames, whenLabel } from '../../shared/format.js';
import { TYPE_META, POSITIVE_STATUS } from '../../shared/constants.js';

const TONE = { time: '#0f9f6e', activity: '#6d4aff', help: '#f26b1d' };

const CTA = {
  availability: 'Bin auch frei',
  activity: 'Bin dabei',
  help_request: 'Ich helfe',
  help_offer: 'Nehm ich gern',
};

const POSITIVE_PHRASE = {
  going: ['ist auch dabei', 'sind auch dabei'],
  free: ['ist auch frei', 'sind auch frei'],
  helping: ['hilft mit', 'helfen mit'],
  accepting: ['ist interessiert', 'sind interessiert'],
};

function othersLine(type, names) {
  if (!names.length) return '';
  const [one, many] = POSITIVE_PHRASE[POSITIVE_STATUS[type]];
  return `${joinNames(names, 3)} ${names.length === 1 ? one : many}`;
}

function layout({ title, description, url, appName, body, accent }) {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${e(title)} · ${e(appName)}</title>
<meta name="description" content="${e(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${e(appName)}">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(description)}">
<meta property="og:url" content="${e(url)}">
<meta property="og:image" content="${e(new URL('/icons/og.png', url).href)}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="${accent}">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<style>
  :root { --accent: ${accent}; color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #faf7f2; color: #1d1a22;
         min-height: 100dvh; display: grid; place-items: center; padding: 20px 16px; }
  @media (prefers-color-scheme: dark) { body { background: #16141a; color: #f3f0f7; } .card { background: #221f28 !important; } .muted { color: #a9a3b3 !important; } }
  .card { width: 100%; max-width: 420px; background: #fff; border-radius: 28px; padding: 28px 24px; box-shadow: 0 10px 40px rgba(0,0,0,.08);
          border-top: 6px solid var(--accent); }
  .kicker { font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
  .emoji { font-size: 56px; line-height: 1; margin: 14px 0 8px; }
  h1 { font-size: 28px; line-height: 1.15; margin: 0 0 10px; }
  .when { font-size: 18px; font-weight: 700; margin: 0 0 6px; }
  .muted { color: #6b6575; margin: 4px 0; }
  .who { margin: 18px 0 22px; font-size: 16px; }
  .btn { display: block; text-align: center; text-decoration: none; background: var(--accent); color: #fff; font-weight: 800;
         font-size: 18px; padding: 17px; border-radius: 18px; }
  .btn.secondary { background: transparent; color: inherit; font-weight: 600; font-size: 15px; padding: 12px; }
  .brand { text-align: center; margin-top: 18px; font-size: 13px; }
</style>
</head>
<body>
<main class="card">${body}</main>
</body>
</html>`;
}

export function renderSharePage({ preview, appName, url, tz }) {
  const meta = TYPE_META[preview.type];
  const accent = TONE[meta.tone];
  const when = spokenWhen(preview.startsAt, preview.endsAt, { tz });
  const hostLine = preview.type === 'activity' ? `${preview.author.name} ist dabei.` : `von ${preview.author.name}`;
  const others = othersLine(preview.type, preview.positiveNames);
  const title = `${preview.emoji ?? meta.emoji} ${preview.title}`;
  const description = preview.cancelled
    ? 'Abgesagt.'
    : [when, preview.location ? `📍 ${preview.location}` : '', hostLine].filter(Boolean).join(' · ');

  const body = preview.cancelled
    ? `<div class="kicker">${e(meta.label)}</div><div class="emoji">🙈</div><h1>${e(preview.title)}</h1>
       <p class="muted">Dieser Eintrag wurde abgesagt.</p>
       <a class="btn secondary" href="/">Zu ${e(appName)}</a>`
    : `<div class="kicker">${e(meta.label)}</div>
       <div class="emoji">${e(preview.emoji ?? meta.emoji)}</div>
       <h1>${e(preview.title)}</h1>
       <p class="when">${e(whenLabel(preview.startsAt, preview.endsAt, { tz }))}</p>
       ${preview.location ? `<p class="muted">📍 ${e(preview.location)}</p>` : ''}
       ${preview.description ? `<p class="muted">„${e(preview.description)}“</p>` : ''}
       <p class="who"><strong>${e(hostLine)}</strong>${others ? `<br>${e(others)}` : ''}</p>
       <a class="btn" href="/#/e/${e(preview.code)}?join=1">${e(CTA[preview.type])}</a>
       <a class="btn secondary" href="/#/e/${e(preview.code)}">Details ansehen</a>`;

  return layout({ title, description, url, appName, accent, body: body + `<p class="brand muted">${e(appName)} – Zeit mit Freunden</p>` });
}

export function renderInvitePage({ invite, code, appName, url }) {
  const inviter = invite.inviter?.name?.split(' ')[0] ?? 'Jemand';
  const title = `${inviter} lädt dich zu „${invite.name}“ ein`;
  const description = `Sieh, wer wann Zeit hat, was deine Freunde machen und wo jemand Hilfe braucht. ${invite.memberCount} Leute sind schon dabei.`;
  const body = `<div class="kicker">Einladung</div>
    <div class="emoji">${e(invite.emoji ?? '👥')}</div>
    <h1>${e(invite.name)}</h1>
    <p class="muted">${e(inviter)} lädt dich ein · ${invite.memberCount} ${invite.memberCount === 1 ? 'Person' : 'Leute'}</p>
    <p class="who">Wer hat Zeit? Wer hat Bock? Wer braucht Hilfe?<br>Alles an einem Ort – privat, nur für eure Gruppe.</p>
    <a class="btn" href="/#/invite/${e(code)}">Gruppe beitreten</a>
    <p class="brand muted">${e(appName)}</p>`;
  return layout({ title, description, url, appName, accent: '#6d4aff', body });
}

export function renderNotFound({ appName }) {
  return layout({
    title: 'Link ungültig',
    description: '',
    url: 'http://localhost/',
    appName,
    accent: '#6b6575',
    body: `<div class="emoji">🤷</div><h1>Dieser Link funktioniert nicht (mehr).</h1><a class="btn" href="/">Zu ${e(appName)}</a>`,
  });
}
