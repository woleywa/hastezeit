// Reusable UI pieces: post cards, participation buttons, people lines, empty states.
import { html, avatar, avatarStack } from './ui.js';
import { store } from './store.js';
import { TYPE_META, POSITIVE_STATUS, DAYPARTS } from '/shared/constants.js';
import { whenLabel, joinNames, firstName, dayLabel } from '/shared/format.js';
import { zonedToDate } from '/shared/time.js';

// Last rendered posts by id, so global actions (share, suggest) can access the full object.
export const postCache = new Map();
export const remember = (posts) => {
  for (const p of [].concat(posts)) postCache.set(p.id, p);
  return posts;
};

export const tone = (type) => `tone-${TYPE_META[type].tone}`;

const POSITIVE_TEXT = {
  activity: ['ist dabei', 'sind dabei'],
  availability: ['ist auch frei', 'sind auch frei'],
  help_request: ['hilft', 'helfen'],
  help_offer: ['ist interessiert', 'sind interessiert'],
};

export function positiveUsers(post) {
  return post.participants.filter((p) => p.status === POSITIVE_STATUS[post.type]).map((p) => p.user);
}

export function isFull(post) {
  return Boolean(post.capacity) && post.positiveCount >= post.capacity && post.myStatus !== POSITIVE_STATUS[post.type];
}

export function cardTitle(post) {
  if (post.type !== 'availability') return post.title;
  return post.isMine ? 'Du hast Zeit' : `${firstName(post.author.name)} hat Zeit`;
}

export function peopleLine(post) {
  const users = positiveUsers(post);
  if (!users.length) {
    if (post.type === 'activity' && !post.isMine) return html`<div class="people">Sei die erste Person 🙌</div>`;
    return '';
  }
  const [one, many] = POSITIVE_TEXT[post.type];
  const names = users.map((u) => u.name);
  return html`<div class="people">${avatarStack(users)}<span><strong>${joinNames(names)}</strong> ${users.length === 1 ? one : many}</span></div>`;
}

export function helpProgress(post) {
  if (post.type !== 'help_request' || !post.capacity) return '';
  const n = Math.min(post.positiveCount, post.capacity);
  const done = n >= post.capacity;
  const label = done
    ? `Alle ${post.capacity} Helfer gefunden 🎉`
    : `${n} von ${post.capacity} ${post.capacity === 1 ? 'Helfer' : 'Helfern'} gefunden`;
  return html`<div class="progress">
    <div class="progress-bar"><span style="width:${(n / post.capacity) * 100}%"></span></div>
    <div class="progress-label ${done ? 'done' : ''}">${label}</div>
  </div>`;
}

export function ideaChips(post, label = 'Lust auf') {
  if (!post.ideas?.length) return '';
  return html`<div class="ideas"><span class="muted" style="font-size:13px;align-self:center">${label}:</span>${post.ideas.map((i) => html`<span class="idea">${i}</span>`)}</div>`;
}

/** The main call-to-action(s) for a card, depending on type and my status. */
export function cardActions(post) {
  const id = post.id;
  if (post.isMine) {
    return html`<button class="btn soft sm" data-action="share-post" data-id="${id}">📤 Teilen</button>`;
  }
  const s = post.myStatus;
  const full = isFull(post);
  switch (post.type) {
    case 'activity':
      if (s === 'going') return html`<button class="btn soft sm" data-action="unparticipate" data-id="${id}">✓ Du bist dabei</button>`;
      return html`<button class="btn sm" data-action="participate" data-status="going" data-id="${id}" ${full ? 'disabled' : ''}>${full ? 'Voll' : 'Bin dabei'}</button>
        ${s === 'maybe'
          ? html`<button class="btn soft sm" data-action="unparticipate" data-id="${id}">✓ Vielleicht</button>`
          : html`<button class="btn ghost sm" data-action="participate" data-status="maybe" data-id="${id}">Vielleicht</button>`}`;
    case 'availability':
      return html`${s === 'free'
        ? html`<button class="btn soft sm" data-action="unparticipate" data-id="${id}">✓ Du bist auch frei</button>`
        : html`<button class="btn sm" data-action="participate" data-status="free" data-id="${id}">Bin auch frei</button>`}
        <button class="btn ghost sm" data-action="suggest" data-id="${id}">💡 Vorschlagen</button>`;
    case 'help_request':
      if (s === 'helping') return html`<button class="btn soft sm" data-action="unparticipate" data-id="${id}">✓ Du hilfst</button>`;
      return html`<button class="btn sm" data-action="participate" data-status="helping" data-id="${id}" ${full ? 'disabled' : ''}>${full ? 'Genug Hilfe da' : '🙋 Ich helfe'}</button>`;
    case 'help_offer':
      if (s === 'accepting') return html`<button class="btn soft sm" data-action="unparticipate" data-id="${id}">✓ Angefragt</button>`;
      return html`<button class="btn sm" data-action="participate" data-status="accepting" data-id="${id}" ${full ? 'disabled' : ''}>${full ? 'Vergeben' : 'Nehm ich gern'}</button>`;
    default:
      return '';
  }
}

export function postCard(post) {
  remember(post);
  const meta = TYPE_META[post.type];
  const groupNames = post.groups.map((g) => `${g.emoji ?? ''} ${g.name}`.trim()).join(', ');
  return html`<article class="card ${tone(post.type)}" data-action="open-post" data-id="${post.id}">
    <div class="card-head">
      <span class="row" style="flex:none;gap:8px;align-items:center">${avatar(post.author, 'sm')}
        <strong style="font-size:14px">${post.isMine ? 'Du' : firstName(post.author.name)}</strong></span>
      <span class="kicker">${meta.label}</span>
    </div>
    <div class="card-title">
      <div class="card-emoji" aria-hidden="true">${post.emoji ?? meta.emoji}</div>
      <div style="min-width:0">
        <h3>${cardTitle(post)}</h3>
        <div class="card-meta"><strong>${whenLabel(post.startsAt, post.endsAt)}</strong></div>
      </div>
    </div>
    ${post.description ? html`<p class="card-desc">„${post.description}“</p>` : ''}
    ${post.location ? html`<div class="card-loc">📍 ${post.location}</div>` : ''}
    ${post.type === 'availability' ? ideaChips(post) : ''}
    ${helpProgress(post)}
    ${peopleLine(post)}
    <div class="card-foot">
      ${cardActions(post)}
      <span class="spacer"></span>
      ${post.commentCount ? html`<span class="comment-count">💬 ${post.commentCount}</span>` : ''}
    </div>
    ${groupNames ? html`<div class="card-groups" style="margin-top:10px">${groupNames}</div>` : ''}
  </article>`;
}

/** Feed list grouped by day ("Heute", "Morgen", "Dienstag", …). */
export function dayGroupedCards(posts) {
  const out = [];
  let currentDay = null;
  for (const p of posts) {
    const label = dayLabel(p.startsAt);
    if (label !== currentDay) {
      currentDay = label;
      out.push(html`<h2 class="day-head">${label}</h2>`);
    }
    out.push(postCard(p));
  }
  return out;
}

export function emptyState(emoji, title, text, cta = '') {
  return html`<div class="empty"><div class="e-emoji">${emoji}</div><h3>${title}</h3><p>${text}</p>${cta}</div>`;
}

export function updateBadges() {
  for (const el of document.querySelectorAll('[data-unread]')) {
    el.hidden = !store.unread;
    el.textContent = store.unread > 9 ? '9+' : String(store.unread);
  }
}

export function chooserContent() {
  const choice = (kind, type, emoji, title, sub) => html`<button class="choice tone-${TYPE_META[type].tone}" data-action="new" data-kind="${kind}">
      <span class="c-emoji">${emoji}</span><span><strong>${title}</strong><span>${sub}</span></span></button>`;
  return html`<h2>Was möchtest du?</h2>
    ${choice('slots', 'availability', '🗓️', 'Wann hast du Zeit?', 'Zeiten antippen – Runden entstehen automatisch')}
    ${choice('time', 'availability', '🕐', 'Ich habe Zeit (genau)', 'Uhrzeit + Notiz posten – Freunde melden sich')}
    ${choice('activity', 'activity', '🎯', 'Ich möchte etwas machen', 'Tennis, Bar, Kino … wer kommt mit?')}
    ${choice('help', 'help_request', '🤝', 'Ich brauche / biete Hilfe', 'Couch tragen, Auto leihen, Umzug …')}`;
}

// ---- Automatic rounds ------------------------------------------------------------------------
/** "Heute", "Morgen", "Freitag", "Mo, 13. Okt" for a YYYY-MM-DD date. */
export const slotDayLabel = (date) => dayLabel(zonedToDate(date, '12:00').toISOString());

export const roundPath = (r) => `/round/${r.group.id}/${r.date}/${r.part}`;

export function roundCard(r) {
  const dp = DAYPARTS.find((d) => d.id === r.part);
  const names = r.members.map((m) => (m.id === store.user?.id ? 'Du' : firstName(m.name)));
  return html`<article class="card round-card tone-time" data-action="open-round" data-href="${roundPath(r)}">
    <div class="card-title">
      <div class="card-emoji" aria-hidden="true">${dp.emoji}</div>
      <div style="min-width:0;flex:1">
        <h3>${slotDayLabel(r.date)} ${dp.label}</h3>
        <div class="card-meta">${dp.start}–${dp.end} · ${r.group.emoji ?? ''} ${r.group.name}</div>
      </div>
      ${r.includesMe ? html`<span class="kicker">Runde</span>` : ''}
    </div>
    <div class="people">${avatarStack(r.members, 5)}<span><strong>${joinNames(names, 3)}</strong> ${r.includesMe ? '' : 'haben Zeit'}</span></div>
    <div class="card-foot">
      ${r.includesMe
        ? html`<button class="btn soft sm" data-action="open-round" data-href="${roundPath(r)}">Planen →</button>`
        : html`<button class="btn sm" data-action="join-round" data-date="${r.date}" data-part="${r.part}">🙋 Ich auch</button>`}
      <span class="spacer"></span>
      ${r.messageCount ? html`<span class="comment-count">💬 ${r.messageCount}</span>` : ''}
    </div>
  </article>`;
}
