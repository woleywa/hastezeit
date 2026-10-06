// "Was geht diese Woche bei meinen Freunden?" – a simple 7-day agenda, not a calendar.
import { api } from '../api.js';
import { html } from '../ui.js';
import { navigate } from '../router.js';
import { remember, tone, cardTitle } from '../components.js';
import { dateParts, addDays, weekdayOf } from '/shared/time.js';
import { WEEKDAYS_SHORT, timeRange, firstName } from '/shared/format.js';
import { POSITIVE_STATUS } from '/shared/constants.js';

const MONTHS = ['Jan', 'Feb', 'März', 'Apr', 'Mai', 'Juni', 'Juli', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

const isMinePlan = (p) => p.isMine || p.myStatus === POSITIVE_STATUS[p.type] || p.myStatus === 'maybe';

export default async function weekView(_params, query) {
  const offset = Number(query.w ?? 0) || 0;
  const onlyMine = query.mine === '1';
  const today = dateParts(new Date()).date;
  // Rolling window starting today – "what's on in the next days" beats a Monday-based calendar week.
  const monday = addDays(today, offset * 7);
  const sunday = addDays(monday, 6);
  const { posts } = await api.posts({
    from: new Date(`${monday}T00:00`).toISOString(),
    to: new Date(`${addDays(monday, 7)}T00:00`).toISOString(),
  });
  remember(posts);
  const visible = onlyMine ? posts.filter(isMinePlan) : posts;

  const byDay = new Map(Array.from({ length: 7 }, (_, i) => [addDays(monday, i), []]));
  for (const p of visible) byDay.get(dateParts(p.startsAt).date)?.push(p);

  const label = (d) => `${Number(d.slice(8))}. ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
  const rangeLabel = offset === 0 ? 'Die nächsten 7 Tage' : offset === 1 ? 'Danach' : offset < 0 ? 'Vorher' : `In ${offset} Wochen`;
  const link = (w, mine) => `/week?${new URLSearchParams({ ...(w ? { w } : {}), ...(mine ? { mine: '1' } : {}) })}`;

  const item = (p) => html`<a class="w-item ${tone(p.type)} ${isMinePlan(p) ? 'mine' : ''}" href="#/post/${p.id}">
      <span class="w-time">${timeRange(p.startsAt, p.endsAt).replace('–', '–​')}</span>
      <span class="w-main">
        <div class="w-title">${p.emoji} ${cardTitle(p)}</div>
        <div class="w-sub">${[p.isMine ? 'Du' : firstName(p.author.name), p.positiveCount ? `+${p.positiveCount}` : '', p.location].filter(Boolean).join(' · ')}</div>
      </span>
      ${p.isMine ? html`<span class="tag yes">Du</span>` : isMinePlan(p) ? html`<span class="tag yes">✓</span>` : ''}
    </a>`;

  const days = [...byDay.entries()].map(([date, items]) => {
    const past = date < today;
    return html`<div class="week-day ${date === today ? 'today' : ''}" style="${past ? 'opacity:.55' : ''}">
      <div class="wd-label"><div class="wd">${WEEKDAYS_SHORT[weekdayOf(date)]}</div><div class="dn">${Number(date.slice(8))}</div></div>
      <div class="week-items">
        ${items.length
          ? items.map(item)
          : html`<div class="w-empty"><span>${past ? '–' : 'Noch nichts'}</span>${past ? '' : html`<a href="#/new/time?date=${date}">+ Zeit eintragen</a>`}</div>`}
      </div>
    </div>`;
  });

  return {
    html: html`
      <header class="topbar"><div class="title-wrap"><div class="sub">Woche</div><h1>Was geht?</h1></div></header>
      <div class="week-nav">
        <button class="icon-btn" data-action="go" data-to="${link(offset - 1, onlyMine)}" aria-label="Vorherige Woche">‹</button>
        <div class="range">${rangeLabel}<div class="muted" style="font-size:13px;font-weight:600">${label(monday)} – ${label(sunday)}</div></div>
        <button class="icon-btn" data-action="go" data-to="${link(offset + 1, onlyMine)}" aria-label="Nächste Woche">›</button>
      </div>
      <div class="chips">
        <button class="chip ${!onlyMine ? 'on' : ''}" data-action="go" data-to="${link(offset, false)}">Alle Freunde</button>
        <button class="chip ${onlyMine ? 'on' : ''}" data-action="go" data-to="${link(offset, true)}">Meine Pläne</button>
      </div>
      <div class="legend" style="margin-top:12px">
        <span class="tone-time"><i></i>Zeit</span><span class="tone-activity"><i></i>Aktivität</span><span class="tone-help"><i></i>Hilfe</span>
      </div>
      <div style="margin-top:6px">${days}</div>`,
    actions: {
      go: (el) => navigate(el.dataset.to, { replace: true }),
    },
  };
}
