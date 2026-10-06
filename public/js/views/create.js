// "Neuer Eintrag" – optimised for < 20 seconds:
//  • one tap on type, smart defaults for day & time, all groups preselected
//  • the "Was?" field understands quick text like "Di 18-20 Tennis Tempelhof" (shared/parse.js)
import { api } from '../api.js';
import { store, prefs } from '../store.js';
import { html, $, $$, vibrate } from '../ui.js';
import { navigate } from '../router.js';
import { chooserContent, emptyState } from '../components.js';
import { IDEAS, TYPE_META } from '/shared/constants.js';
import { parseQuickInput } from '/shared/parse.js';
import { dateParts, addDays, weekdayOf } from '/shared/time.js';
import { WEEKDAYS_SHORT, WEEKDAYS } from '/shared/format.js';
import { guessEmoji } from '/shared/emoji.js';

const KINDS = {
  time: { type: 'availability', title: 'Ich habe Zeit', cta: 'Zeit teilen', start: '18:00', duration: 3 },
  activity: { type: 'activity', title: 'Ich möchte etwas machen', cta: 'Posten', start: '19:00', duration: 0 },
  help: { type: 'help_request', title: 'Hilfe', cta: 'Posten', start: '10:00', duration: 0 },
};

const pad = (n) => String(n).padStart(2, '0');
const addHours = (time, h) => {
  const [hh, mm] = time.split(':').map(Number);
  return `${pad((hh + h) % 24)}:${pad(mm)}`;
};

export function chooserView() {
  return {
    html: html`<header class="topbar compact"><button class="icon-btn" data-action="back" aria-label="Schließen">✕</button></header>
      <div style="margin-top:8px">${chooserContent()}</div>`,
  };
}

export default function createView({ kind }, query) {
  const cfg = KINDS[kind];
  if (!cfg) return navigate('/new', { replace: true });
  if (!store.groups.length) {
    return {
      html: html`<header class="topbar compact"><button class="icon-btn" data-action="back">✕</button></header>
        ${emptyState('👥', 'Erst eine Gruppe', 'Damit deine Freunde deinen Eintrag sehen, brauchst du eine Gruppe.',
          html`<a class="btn dark" href="#/groups?new=1">Gruppe erstellen</a>`)}`,
    };
  }

  const now = dateParts(new Date());
  const today = now.date;
  const state = {
    type: kind === 'help' && query.type === 'help_offer' ? 'help_offer' : cfg.type,
    date: query.date ?? today,
    start: query.start ?? cfg.start,
    end: query.end ?? (cfg.duration ? addHours(query.start ?? cfg.start, cfg.duration) : ''),
    ideas: new Set(),
    groupIds: new Set(
      (query.group ? [query.group] : prefs.get('lastGroups', null) ?? store.groups.map((g) => g.id)).filter((id) =>
        store.groups.some((g) => g.id === id),
      ),
    ),
    capacity: kind === 'help' ? 1 : null,
    parsed: null,
  };
  if (!state.groupIds.size) store.groups.forEach((g) => state.groupIds.add(g.id));
  // Default time already over today? → next full hour.
  if (!query.start && state.date === today && state.start <= now.time) {
    const nextHour = Math.min(Number(now.time.slice(0, 2)) + 1, 23);
    state.start = `${pad(nextHour)}:00`;
    if (cfg.duration) state.end = addHours(state.start, cfg.duration);
  }

  const toneClass = () => `tone-${TYPE_META[state.type].tone}`;
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const dayName = (d, i) => (i === 0 ? 'Heute' : i === 1 ? 'Morgen' : `${WEEKDAYS_SHORT[weekdayOf(d)]} ${Number(d.slice(8))}.`);
  const customDate = !days.includes(state.date);

  const titleField = (label, placeholder) => html`<div class="field">
      <label for="f-title">${label}</label>
      <input id="f-title" class="input big" name="title" autocomplete="off" enterkeyhint="done"
        placeholder="${placeholder}" value="${query.title ?? ''}" maxlength="120" autofocus>
      <div id="parsed" class="parsed" aria-live="polite"></div>
    </div>`;

  const dayField = html`<div class="field">
      <span class="label">Wann?</span>
      <div class="chips" id="day-chips">
        ${days.map((d, i) => html`<button type="button" class="chip ${toneClass()} ${state.date === d ? 'on' : ''}" data-action="day" data-date="${d}">${dayName(d, i)}</button>`)}
        <button type="button" class="chip ${toneClass()} ${customDate ? 'on' : ''}" data-action="pick-date">📅</button>
      </div>
      <input type="date" class="input" id="f-date" min="${today}" value="${state.date}" style="margin-top:10px" ${customDate ? '' : 'hidden'}>
    </div>`;

  const timeField = (withEnd) => html`<div class="field">
      <div class="row">
        <input type="time" class="input time-input" id="f-start" value="${state.start}" step="900" aria-label="Von">
        ${withEnd
          ? html`<span class="sep">bis</span><input type="time" class="input time-input" id="f-end" value="${state.end}" step="900" aria-label="Bis">`
          : html`<span id="end-wrap" class="row" style="flex:1" ${state.end ? '' : 'hidden'}><span class="sep">bis</span>
              <input type="time" class="input time-input" id="f-end" value="${state.end}" step="900" aria-label="Bis"></span>
              <button type="button" class="link-btn" data-action="show-end" style="flex:none" ${state.end ? 'hidden' : ''}>+ Ende</button>`}
      </div>
    </div>`;

  const locationField = html`<div class="field"><input class="input" id="f-location" placeholder="📍 Wo? (optional)" maxlength="120" value="${query.location ?? ''}" autocomplete="off"></div>`;

  const groupField = html`<div class="field">
      <span class="label">Wer sieht das?</span>
      <div class="chips" id="group-chips">
        ${store.groups.map((g) => html`<button type="button" class="chip ${state.groupIds.has(g.id) ? 'on' : ''}" data-action="group" data-id="${g.id}">${g.emoji} ${g.name}</button>`)}
      </div>
    </div>`;

  let body;
  if (kind === 'time') {
    body = html`
      ${dayField}
      <div class="field"><span class="label">Von – bis</span>${timeField(true)}</div>
      <div class="field">
        <span class="label">Lust auf … (optional)</span>
        <div class="ideas" id="idea-chips" style="gap:8px">
          ${IDEAS.map((i) => html`<button type="button" class="chip ${toneClass()}" data-action="idea" data-idea="${i}">${i}</button>`)}
        </div>
      </div>
      <div class="field"><input class="input" id="f-description" placeholder="Notiz, z. B. „Noch nichts vor.“" maxlength="300" autocomplete="off"></div>
      ${groupField}`;
  } else if (kind === 'activity') {
    body = html`
      ${titleField('Was?', 'z. B. Tennis Di 18-20 Tempelhof')}
      ${dayField}
      ${timeField(false)}
      ${locationField}
      <button type="button" class="link-btn" data-action="more" id="more-btn" style="align-self:flex-start">+ Beschreibung & Plätze</button>
      <div id="more" class="form" hidden>
        <div class="field"><textarea class="textarea" id="f-description" placeholder="Beschreibung (optional)" maxlength="1000"></textarea></div>
        <div class="field row" style="justify-content:space-between">
          <span class="label" style="margin:0">Max. Plätze</span>
          <input type="number" inputmode="numeric" min="1" max="999" class="input" id="f-capacity" placeholder="egal" style="max-width:110px;text-align:center">
        </div>
      </div>
      ${groupField}`;
  } else {
    body = html`
      <div class="segmented" id="help-toggle">
        <button type="button" data-action="help-type" data-type="help_request" class="${state.type === 'help_request' ? 'on' : ''}">🙋 Ich brauche Hilfe</button>
        <button type="button" data-action="help-type" data-type="help_offer" class="${state.type === 'help_offer' ? 'on' : ''}">🤝 Ich biete Hilfe</button>
      </div>
      ${titleField('Wobei?', state.type === 'help_offer' ? 'z. B. Hab ein Auto, kann was transportieren' : 'z. B. Couch runtertragen Sa 14 Uhr')}
      ${dayField}
      ${timeField(false)}
      <div class="field row" style="justify-content:space-between">
        <span class="label" style="margin:0" id="cap-label">${state.type === 'help_offer' ? 'Für wie viele?' : 'Wie viele Leute?'}</span>
        <span class="stepper"><button type="button" data-action="cap" data-d="-1" aria-label="weniger">−</button>
          <output id="f-cap">${state.capacity}</output>
          <button type="button" data-action="cap" data-d="1" aria-label="mehr">+</button></span>
      </div>
      ${locationField}
      <div class="field"><textarea class="textarea" id="f-description" placeholder="Details (optional)" maxlength="1000"></textarea></div>
      ${groupField}`;
  }

  const ctaLabel = () => (kind === 'help' ? (state.type === 'help_offer' ? 'Hilfe anbieten' : 'Hilfe anfragen') : cfg.cta);

  // ---- behaviour -------------------------------------------------------------------------------
  const setDate = (date, root = document) => {
    state.date = date;
    const inChips = days.includes(date);
    $$('#day-chips .chip', root).forEach((c) => c.classList.toggle('on', inChips ? c.dataset.date === date : c.dataset.action === 'pick-date'));
    const input = $('#f-date', root);
    input.value = date;
    input.hidden = inChips;
  };

  const showParsed = (p) => {
    const el = $('#parsed');
    if (!el) return;
    if (!p?.recognized) {
      el.innerHTML = '';
      return;
    }
    const bits = [];
    if (p.date) {
      const i = days.indexOf(p.date);
      bits.push(i >= 0 ? dayName(p.date, i).replace(/ \d+\.$/, '') : `${WEEKDAYS[weekdayOf(p.date)]}, ${p.date.slice(8)}.${p.date.slice(5, 7)}.`);
    }
    if (p.start) bits.push(p.end ? `${p.start}–${p.end}` : p.start);
    if (p.location) bits.push(`📍 ${p.location}`);
    if (p.title) bits.push(`„${p.title}“`);
    el.innerHTML = String(html`<span>✨ ${bits.join(' · ')}</span>`);
  };

  let parseTimer;
  const onTitleInput = (e) => {
    clearTimeout(parseTimer);
    parseTimer = setTimeout(() => {
      const text = e.target.value;
      const p = text.trim().length > 2 ? parseQuickInput(text, { today }) : null;
      state.parsed = p?.recognized ? p : null;
      showParsed(state.parsed);
      if (!state.parsed) return;
      if (p.date) setDate(p.date);
      if (p.start) $('#f-start').value = p.start;
      if (p.end) {
        $('#f-end').value = p.end;
        $('#end-wrap')?.removeAttribute('hidden');
        $('[data-action="show-end"]')?.setAttribute('hidden', '');
      }
      if (p.location && $('#f-location')) $('#f-location').value = p.location;
      if (kind === 'help' && (p.type === 'help_offer' || p.type === 'help_request') && p.type !== state.type) {
        setHelpType(p.type);
      }
    }, 250);
  };

  const setHelpType = (type) => {
    state.type = type;
    $$('#help-toggle button').forEach((b) => b.classList.toggle('on', b.dataset.type === type));
    $('#cap-label').textContent = type === 'help_offer' ? 'Für wie viele?' : 'Wie viele Leute?';
    $('#submit-btn').textContent = ctaLabel();
  };

  async function submit() {
    const raw = $('#f-title')?.value.trim() ?? '';
    const title = state.parsed?.title || raw;
    if (kind !== 'time' && !title) {
      $('#f-title').focus();
      throw new Error(kind === 'help' ? 'Wobei brauchst du Hilfe?' : 'Was habt ihr vor?');
    }
    if (!state.groupIds.size) throw new Error('Wähl mindestens eine Gruppe aus.');
    const start = $('#f-start').value || state.start;
    const endInput = $('#f-end');
    const end = endInput && !endInput.closest('[hidden]') ? endInput.value : '';
    const startsAt = new Date(`${state.date}T${start}`);
    let endsAt = null;
    if (end) {
      endsAt = new Date(`${state.date}T${end}`);
      if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 86400000); // over midnight
    }
    const capacityValue = kind === 'help' ? state.capacity : $('#f-capacity')?.value;
    const payload = {
      type: state.type,
      title: kind === 'time' ? undefined : title,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt?.toISOString() ?? null,
      location: $('#f-location')?.value || null,
      description: $('#f-description')?.value || null,
      capacity: capacityValue ? Number(capacityValue) : null,
      ideas: [...state.ideas],
      groupIds: [...state.groupIds],
      emoji: kind === 'time' ? (state.ideas.size ? [...state.ideas][0].split(' ')[0] : '👋') : guessEmoji(`${title} ${raw}`, state.type),
      source: state.parsed ? 'nlp' : 'app',
      rawInput: state.parsed ? raw : null,
    };
    const btn = $('#submit-btn');
    btn.disabled = true;
    try {
      const { post } = await api.createPost(payload);
      prefs.set('lastGroups', [...state.groupIds]);
      vibrate(20);
      navigate(`/post/${post.id}?created=1`, { replace: true });
    } finally {
      if (btn.isConnected) btn.disabled = false;
    }
  }

  return {
    html: html`
      <form class="${toneClass()}" data-submit="create" id="create-form" novalidate>
        <header class="topbar compact">
          <button type="button" class="icon-btn" data-action="back" aria-label="Schließen">✕</button>
          <h1>${kind === 'help' ? 'Hilfe' : cfg.title}</h1>
        </header>
        <div class="form" style="margin-top:8px">${body}</div>
        <div class="sticky-cta"><div><button class="btn lg block" id="submit-btn" type="submit">${ctaLabel()}</button></div></div>
      </form>`,
    mount(root) {
      $('#f-title', root)?.addEventListener('input', onTitleInput);
      $('#f-date', root)?.addEventListener('change', (e) => e.target.value && setDate(e.target.value, root));
      $('#f-start', root)?.addEventListener('change', (e) => {
        // keep the window length for "Ich habe Zeit"
        if (kind === 'time' && cfg.duration) $('#f-end', root).value = addHours(e.target.value, cfg.duration);
      });
      if (query.title) onTitleInput({ target: $('#f-title', root) });
    },
    actions: {
      day: (el) => setDate(el.dataset.date),
      'pick-date': () => {
        const input = $('#f-date');
        input.hidden = false;
        input.showPicker?.();
        input.focus();
      },
      'show-end': (el) => {
        el.hidden = true;
        $('#end-wrap').hidden = false;
        const endInput = $('#f-end');
        if (!endInput.value) endInput.value = addHours($('#f-start').value || state.start, 2);
      },
      idea: (el) => {
        const idea = el.dataset.idea;
        state.ideas.has(idea) ? state.ideas.delete(idea) : state.ideas.size < 6 && state.ideas.add(idea);
        el.classList.toggle('on', state.ideas.has(idea));
      },
      group: (el) => {
        const id = el.dataset.id;
        state.groupIds.has(id) ? state.groupIds.delete(id) : state.groupIds.add(id);
        el.classList.toggle('on', state.groupIds.has(id));
      },
      more: (el) => {
        el.hidden = true;
        $('#more').hidden = false;
      },
      'help-type': (el) => setHelpType(el.dataset.type),
      cap: (el) => {
        state.capacity = Math.max(1, Math.min(20, state.capacity + Number(el.dataset.d)));
        $('#f-cap').textContent = state.capacity;
      },
      create: submit,
    },
  };
}
