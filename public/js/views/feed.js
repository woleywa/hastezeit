import { api } from '../api.js';
import { store } from '../store.js';
import { html } from '../ui.js';
import { navigate } from '../router.js';
import { dayGroupedCards, emptyState, remember, roundCard } from '../components.js';
import { firstName } from '/shared/format.js';

const FILTERS = [
  ['all', 'Alles', ''],
  ['availability', '🕐 Zeit', 'tone-time'],
  ['activity', '🎯 Aktivitäten', 'tone-activity'],
  ['help', '🤝 Hilfe', 'tone-help'],
];

export default async function feedView(_params, query) {
  const type = query.f && query.f !== 'all' ? query.f : undefined;
  const groupId = query.g || undefined;
  const [{ posts }, slots] = await Promise.all([api.posts({ type, groupId }), api.slots().catch(() => null)]);
  remember(posts);

  const qs = (f, g) => new URLSearchParams(Object.entries({ f, g }).filter(([, v]) => v && v !== 'all')).toString();
  const filterChips = FILTERS.map(
    ([key, label, tone]) => html`<button class="chip ${tone} ${(type ?? 'all') === key ? 'on' : ''}"
      data-action="filter" data-q="${qs(key, groupId)}">${label}</button>`,
  );
  const groupChips =
    store.groups.length > 1
      ? html`<div class="chips" style="margin-top:8px">
          <button class="chip small ${!groupId ? 'on' : ''}" data-action="filter" data-q="${qs(type)}">Alle Gruppen</button>
          ${store.groups.map(
            (g) => html`<button class="chip small ${groupId === g.id ? 'on' : ''}" data-action="filter" data-q="${qs(type, g.id)}">${g.emoji} ${g.name}</button>`,
          )}</div>`
      : '';

  let list;
  if (!store.groups.length) {
    list = emptyState('👥', 'Noch keine Gruppe', 'Gründe eine Gruppe und lade deine Freunde per Link ein.',
      html`<a class="btn dark" href="#/groups?new=1">Gruppe erstellen</a>`);
  } else if (!posts.length) {
    list = emptyState('🌤️', type || groupId ? 'Hier ist gerade nichts los' : 'Noch ist es ruhig',
      'Mach den Anfang – sag, wann du Zeit hast oder worauf du Bock hast.',
      html`<button class="btn dark" data-action="plus">+ Eintrag erstellen</button>`);
  } else {
    list = dayGroupedCards(posts);
  }

  return {
    html: html`
      <header class="topbar">
        <div class="title-wrap">
          <div class="sub">Hi ${firstName(store.user.name)} 👋</div>
          <h1>Was geht bei euch?</h1>
        </div>
        <a class="icon-btn" href="#/notifications" aria-label="Benachrichtigungen">🔔
          <span class="badge-dot" data-unread ${store.unread ? '' : 'hidden'}>${store.unread > 9 ? '9+' : store.unread}</span></a>
      </header>

      <div class="quick">
        <button class="time" data-action="new" data-kind="slots"><span class="q-emoji">🗓️</span>Ich habe Zeit</button>
        <button class="activity" data-action="new" data-kind="activity"><span class="q-emoji">🎯</span>Aktivität</button>
        <button class="help" data-action="new" data-kind="help"><span class="q-emoji">🤝</span>Hilfe</button>
      </div>

      ${roundsStrip(slots)}

      <div class="chips">${filterChips}</div>
      ${groupChips}
      ${list}`,
    actions: {
      filter: (el) => navigate(`/${el.dataset.q ? `?${el.dataset.q}` : ''}`, { replace: true }),
    },
  };
}

/** "Deine Runden" on top of the feed – or a nudge to tick some times. */
function roundsStrip(slots) {
  if (!slots || !store.groups.length) return '';
  const mine = slots.rounds.filter((r) => r.includesMe).slice(0, 3);
  if (mine.length) {
    return html`<section style="margin-bottom:18px"><h2 class="day-head" style="margin-top:4px">🎉 Deine Runden</h2>
      ${mine.map((r) => roundCard(r))}
      <a class="link-btn" href="#/zeiten" style="text-decoration:none">Alle Zeiten & Runden →</a></section>`;
  }
  const friendsFree = new Set(Object.values(slots.cells).flatMap((c) => c.friends.map((f) => f.id))).size;
  return html`<a class="banner tone-time" href="#/zeiten" style="display:block;text-decoration:none;margin-top:0">
      <h3>🗓️ Wann hast du diese Woche Zeit?</h3>
      <p style="margin:0">${friendsFree
        ? `${friendsFree} ${friendsFree === 1 ? 'Freund:in hat' : 'Freunde haben'} schon Zeiten eingetragen. Tipp deine an – bei Überschneidung entsteht automatisch eine Runde.`
        : 'Tipp an, wann du kannst. Bei Überschneidung mit Freunden entsteht automatisch eine Runde.'}</p>
    </a>`;
}
