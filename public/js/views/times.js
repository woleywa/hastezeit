// "Wann hast du Zeit?" – tick day parts in a week grid. Whoever ticks the same time in the same
// friend group automatically lands in a round (shared/rounds.js). This is the heart of the app.
import { api } from '../api.js';
import { html, toast, vibrate, avatar, avatarStack, relativeTime, $ } from '../ui.js';
import { navigate, rerender } from '../router.js';
import { slotDayLabel, roundCard, roundPath } from '../components.js';
import { store } from '../store.js';
import { DAYPARTS, IDEAS } from '/shared/constants.js';
import { dateParts, addDays, weekdayOf } from '/shared/time.js';
import { WEEKDAYS_SHORT, joinNames, firstName } from '/shared/format.js';
import { rollDice } from '/shared/rounds.js';

const MONTHS = ['Jan', 'Feb', 'März', 'Apr', 'Mai', 'Juni', 'Juli', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const dateShort = (d) => `${Number(d.slice(8))}. ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

/** Day part already over today? Then it can't be ticked any more. */
function isPast(date, part, today, nowTime) {
  if (date < today) return true;
  if (date > today) return false;
  return DAYPARTS.find((d) => d.id === part).end <= nowTime;
}

export default async function timesView(_params, query) {
  const offset = Math.max(0, Number(query.w ?? 0) || 0);
  const now = dateParts(new Date());
  const from = addDays(now.date, offset * 7);
  const data = await api.slots({ from, days: 7 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const myRounds = data.rounds.filter((r) => r.includesMe);
  const openRounds = data.rounds.filter((r) => !r.includesMe);
  const roundAt = (date, part) => myRounds.find((r) => r.date === date && r.part === part);

  const cell = (date, part) => {
    const c = data.cells[`${date}~${part}`] ?? { mine: false, friends: [] };
    const past = isPast(date, part, now.date, now.time);
    const round = c.mine && roundAt(date, part);
    const n = c.friends.length;
    const label = `${slotDayLabel(date)} ${DAYPARTS.find((d) => d.id === part).label}: ${c.mine ? 'du hast Zeit' : 'frei'}${n ? `, ${n} Freunde` : ''}`;
    return html`<button class="slot ${c.mine ? 'on' : ''} ${round ? 'match' : ''}" data-action="slot" data-date="${date}" data-part="${part}"
        data-on="${c.mine ? '1' : ''}" ${past ? 'disabled' : ''} aria-pressed="${c.mine}" aria-label="${label}">
      <span class="slot-mark">${round ? '🎉' : c.mine ? '✓' : ''}</span>
      ${n ? html`<span class="slot-count">${n}</span>` : ''}
    </button>`;
  };

  const grid = html`<div class="slot-grid" role="grid">
      <span></span>
      ${days.map((d) => html`<span class="slot-day ${d === now.date ? 'today' : ''}"><b>${d === now.date ? 'Heute' : WEEKDAYS_SHORT[weekdayOf(d)]}</b>${Number(d.slice(8))}.</span>`)}
      ${DAYPARTS.map(
        (p) => html`<span class="slot-part"><span>${p.emoji}</span>${p.short}</span>${days.map((d) => cell(d, p.id))}`,
      )}
    </div>`;

  const hasAny = data.mySlots.length > 0;

  return {
    html: html`
      <header class="topbar"><div class="title-wrap"><div class="sub">Zeiten</div><h1>Wann hast du Zeit?</h1></div></header>
      <p class="lead">Tipp alles an, wo du kannst. Wer aus deiner Gruppe zur gleichen Zeit kann, landet automatisch mit dir in einer <strong>Runde</strong>.</p>

      <div class="week-nav">
        <button class="icon-btn" data-action="go" data-to="/zeiten${offset > 1 ? `?w=${offset - 1}` : ''}" ${offset === 0 ? 'disabled' : ''} aria-label="Vorherige Woche">‹</button>
        <div class="range">${offset === 0 ? 'Diese 7 Tage' : offset === 1 ? 'Danach' : `In ${offset} Wochen`}
          <div class="muted" style="font-size:13px;font-weight:600">${dateShort(days[0])} – ${dateShort(days[6])}</div></div>
        <button class="icon-btn" data-action="go" data-to="/zeiten?w=${offset + 1}" ${offset >= 3 ? 'disabled' : ''} aria-label="Nächste Woche">›</button>
      </div>

      ${grid}
      <div class="legend" style="margin-top:10px">
        <span><b class="lg-on">✓</b> du</span><span><b class="lg-count">2</b> Freunde frei</span><span>🎉 Runde</span>
      </div>

      <section class="section"><h2 class="section-title"><span>Deine Runden</span><span>${myRounds.length || ''}</span></h2>
        ${myRounds.length
          ? myRounds.map((r) => roundCard(r))
          : html`<div class="install-tip">${hasAny
              ? 'Noch keine Überschneidung. Sobald jemand die gleiche Zeit antippt, entsteht hier automatisch eure Runde.'
              : 'Tipp oben 2–3 Zeiten an. Sobald jemand die gleiche Zeit hat, entsteht hier eure Runde.'}</div>`}
      </section>

      ${openRounds.length
        ? html`<section class="section"><h2 class="section-title"><span>Da können schon andere</span></h2>
            ${openRounds.map((r) => roundCard(r))}</section>`
        : ''}

      <section class="section stack">
        <a class="btn ghost block" href="#/week">🗓️ Alle Pläne der Woche ansehen</a>
        <a class="btn ghost block" href="#/new/time">🕐 Genaue Uhrzeit mit Notiz posten</a>
      </section>`,
    actions: {
      go: (el) => navigate(el.dataset.to, { replace: true }),
      slot: async (el) => {
        vibrate();
        const { date, part } = el.dataset;
        const free = !el.dataset.on;
        el.classList.toggle('on', free); // instant feedback
        const result = await api.setSlot(date, part, free);
        if (free) {
          const r = result.rounds.find((x) => x.includesMe && x.date === date && x.part === part);
          if (r) {
            const others = r.members.filter((m) => m.id !== store.user.id).map((m) => m.name);
            toast(`🎉 Runde mit ${joinNames(others)}!`, { action: 'Öffnen', onAction: () => navigate(roundPath(r)), duration: 5000 });
          }
        }
        await rerender();
      },
      'join-round': async (el) => {
        await api.setSlot(el.dataset.date, el.dataset.part, true);
        toast('Du bist dabei 🙌');
        await rerender();
      },
    },
  };
}

export async function roundView({ groupId, date, part }) {
  const { round } = await api.round(groupId, date, part);
  const dp = round.daypart;
  const me = store.user.id;
  const names = round.members.map((m) => (m.id === me ? 'Du' : firstName(m.name)));
  const canWrite = round.includesMe;

  return {
    html: html`
      <div class="tone-time">
        <header class="topbar compact">
          <button class="icon-btn" data-action="back" aria-label="Zurück">←</button>
          <span style="flex:1"></span>
        </header>
        <section class="hero">
          <span class="kicker" style="background:var(--surface)">Runde · ${round.group.emoji ?? ''} ${round.group.name}</span>
          <div class="emoji" aria-hidden="true">${dp.emoji}</div>
          <h1>${slotDayLabel(date)} ${dp.label}</h1>
          <div class="when">${dp.start}–${dp.end} Uhr</div>
          <div class="people" style="margin-top:14px">${avatarStack(round.members, 6, 'md')}
            <span><strong>${joinNames(names, 4)}</strong> ${round.members.length === 1 ? 'hat' : 'haben'} Zeit</span></div>
          ${round.others.length ? html`<p class="hint" style="margin:10px 0 0">Noch nicht eingetragen: ${round.others.map((o) => firstName(o.name)).join(', ')}</p>` : ''}
        </section>

        ${canWrite
          ? html`<div class="actions">
              <button class="btn" data-action="plan">📌 Plan fixieren</button>
              <button class="btn soft" data-action="dice">🎲 Würfeln</button>
            </div>
            <div class="ideas" style="gap:8px;margin-top:10px">
              ${IDEAS.slice(0, 6).map((i) => html`<button class="chip small tone-time" data-action="idea" data-idea="${i}">${i}</button>`)}
            </div>`
          : html`<div class="actions"><button class="btn lg" data-action="join">🙋 Ich hab auch Zeit</button></div>`}

        <section class="section"><h2 class="section-title"><span>Chat der Runde</span></h2>
          ${round.messages.length
            ? round.messages.map(
                (m) => html`<div class="comment">${avatar(m.user, 'sm')}<div style="min-width:0;flex:1"><div class="bubble">
                  <div class="who">${m.isMine ? 'Du' : m.user.name} <span class="muted">· ${relativeTime(m.createdAt)}</span></div>
                  <p>${m.body}</p></div></div></div>`,
              )
            : html`<p class="hint">Noch still hier. Schlag was vor oder lass den Würfel entscheiden.</p>`}
          ${canWrite ? '' : html`<p class="hint">Trag dich für diese Zeit ein, dann kannst du mitschreiben.</p>`}
        </section>

        ${canWrite
          ? html`<div class="composer"><form data-submit="send">
              <input class="input" name="body" id="round-input" placeholder="Was machen wir?" maxlength="1000" autocomplete="off" enterkeyhint="send">
              <button type="submit" aria-label="Senden">➤</button></form></div>`
          : ''}
      </div>`,
    actions: {
      join: async () => {
        await api.setSlot(date, part, true);
        toast('Du bist dabei 🙌');
        await rerender();
      },
      send: async (form) => {
        const body = form.body.value.trim();
        if (!body) return;
        await api.roundMessage(groupId, date, part, body);
        form.body.value = '';
        await rerender();
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      },
      idea: async (el) => {
        await api.roundMessage(groupId, date, part, `Wie wär's mit ${el.dataset.idea}?`);
        await rerender();
      },
      dice: async () => {
        vibrate(30);
        const { idea, host } = rollDice(IDEAS, round.members);
        const who = host.id === me ? 'du organisierst' : `${firstName(host.name)} organisiert`;
        await api.roundMessage(groupId, date, part, `🎲 Der Würfel sagt: ${idea} – ${who}!`);
        await rerender();
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      },
      plan: () => {
        const params = new URLSearchParams({ date, start: dp.start, end: dp.end, group: groupId });
        const input = $('#round-input')?.value.trim();
        if (input) params.set('title', input);
        navigate(`/new/activity?${params}`);
      },
    },
  };
}

