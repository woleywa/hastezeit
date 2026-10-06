import { api } from '../api.js';
import { html, avatar, relativeTime, toast, openSheet, closeSheet, confirmSheet, $, vibrate } from '../ui.js';
import { navigate, rerender } from '../router.js';
import { remember, tone, cardTitle, helpProgress, ideaChips, isFull } from '../components.js';
import { postShareText, whatsappHref, sharePost } from '../share.js';
import { TYPE_META, IDEAS } from '/shared/constants.js';
import { whenLabel, firstName } from '/shared/format.js';
import { dateParts } from '/shared/time.js';

const STATUS_LABEL = {
  going: 'Dabei',
  maybe: 'Vielleicht',
  declined: 'Kann nicht',
  free: 'Auch frei',
  helping: 'Hilft',
  accepting: 'Interessiert',
};

export function openSuggestSheet(post) {
  openSheet(
    html`<h2>Was wollt ihr machen?</h2>
      <p class="muted" style="margin:-8px 4px 16px">${firstName(post.author.name)} hat ${whenLabel(post.startsAt, post.endsAt)} Zeit.</p>
      <form data-submit="send-suggestion" class="form">
        <div class="ideas" style="gap:8px">
          ${IDEAS.map((i) => html`<button type="button" class="chip" data-action="pick-idea" data-idea="${i}">${i}</button>`)}
        </div>
        <input class="input" name="body" id="suggest-input" placeholder="oder eigene Idee, z. B. Pizza bei mir" maxlength="200" autocomplete="off">
        <button class="btn block lg tone-time" type="submit">💡 Vorschlagen</button>
      </form>`,
    {
      'pick-idea': (el) => {
        $('#suggest-input').value = el.dataset.idea;
        $('#suggest-input').focus();
      },
      'send-suggestion': async (form) => {
        const body = form.body.value.trim();
        if (!body) return toast('Was schlägst du vor?');
        await api.comment(post.id, body, 'suggestion');
        closeSheet();
        toast('Vorschlag geschickt 💡');
        rerender();
      },
    },
  );
}

function participantList(post) {
  const groups = {};
  for (const p of post.participants) (groups[p.status] ??= []).push(p.user);
  const order = post.type === 'activity' ? ['going', 'maybe', 'declined'] : Object.keys(groups);
  const host = html`<div class="list-item">${avatar(post.author, 'md')}<div class="grow"><div class="title">${post.isMine ? 'Du' : post.author.name}</div></div>
    <span class="tag yes">${post.type === 'activity' ? 'Host' : post.type === 'availability' ? 'Hat Zeit' : post.type === 'help_request' ? 'Braucht Hilfe' : 'Bietet Hilfe'}</span></div>`;
  const rows = order.flatMap((status) =>
    (groups[status] ?? []).map(
      (u) => html`<div class="list-item">${avatar(u, 'md')}<div class="grow"><div class="title">${u.name}</div></div>
        <span class="tag ${['going', 'free', 'helping', 'accepting'].includes(status) ? 'yes' : ''}">${STATUS_LABEL[status]}</span></div>`,
    ),
  );
  const yesCount = post.positiveCount + (post.type === 'activity' ? 1 : 0);
  const title = post.type === 'activity' ? `Wer ist dabei · ${yesCount}${post.capacity ? ` / ${post.capacity + 1}` : ''}` : 'Leute';
  return html`<section class="section"><h2 class="section-title"><span>${title}</span></h2>
    <div class="list">${host}${rows}</div>
    ${!rows.length ? html`<p class="hint">Noch niemand – teil den Link, dann geht's schneller.</p>` : ''}</section>`;
}

function actionArea(post) {
  if (post.isMine) {
    return html`<div class="actions">
      <button class="btn" data-action="share-post" data-id="${post.id}">📤 Freunde einladen</button>
      ${post.type === 'availability' ? html`<button class="btn soft" data-action="plan-from" data-title="">🎯 Plan draus machen</button>` : ''}
    </div>`;
  }
  const s = post.myStatus;
  const full = isFull(post);
  const btn = (status, label) =>
    html`<button class="btn ${s === status ? 'on' : ''}" data-action="status" data-status="${status}" ${full && status !== 'maybe' && status !== 'declined' && s !== status ? 'disabled' : ''}>${s === status ? '✓ ' : ''}${label}</button>`;
  switch (post.type) {
    case 'activity':
      return html`<div class="status-row">${btn('going', full ? 'Voll' : 'Bin dabei')}${btn('maybe', 'Vielleicht')}${btn('declined', 'Kann nicht')}</div>`;
    case 'availability':
      return html`<div class="actions">
        <button class="btn ${s === 'free' ? 'soft' : ''}" data-action="status" data-status="free">${s === 'free' ? '✓ Bin auch frei' : 'Bin auch frei'}</button>
        <button class="btn soft" data-action="suggest" data-id="${post.id}">💡 Aktivität vorschlagen</button></div>`;
    case 'help_request':
      return html`<div class="actions"><button class="btn lg ${s === 'helping' ? 'soft' : ''}" data-action="status" data-status="helping" ${full ? 'disabled' : ''}>
        ${s === 'helping' ? '✓ Du hilfst – danke!' : full ? 'Schon genug Hilfe da 🎉' : '🙋 Ich helfe'}</button></div>`;
    case 'help_offer':
      return html`<div class="actions"><button class="btn lg ${s === 'accepting' ? 'soft' : ''}" data-action="status" data-status="accepting" ${full ? 'disabled' : ''}>
        ${s === 'accepting' ? '✓ Angefragt' : full ? 'Schon vergeben' : '🙌 Nehm ich gern'}</button></div>`;
    default:
      return '';
  }
}

function comments(post) {
  const canPlan = post.isMine && post.type === 'availability';
  return html`<section class="section"><h2 class="section-title"><span>Kommentare${post.comments.length ? ` · ${post.comments.length}` : ''}</span></h2>
    ${post.comments.length ? '' : html`<p class="hint" style="margin-bottom:12px">Noch keine Kommentare. Frag einfach, was noch fehlt.</p>`}
    ${post.comments.map(
      (c) => html`<div class="comment">${avatar(c.user, 'sm')}
        <div style="min-width:0;flex:1">
          <div class="bubble ${c.kind === 'suggestion' ? 'suggestion tone-time' : ''}">
            <div class="who">${c.isMine ? 'Du' : c.user.name} <span class="muted">· ${relativeTime(c.createdAt)}${c.kind === 'suggestion' ? ' · 💡 Vorschlag' : ''}</span></div>
            <p>${c.body}</p>
          </div>
          <div class="row" style="gap:4px;justify-content:flex-start">
            ${canPlan && c.kind === 'suggestion' ? html`<button class="link-btn tone-time" data-action="plan-from" data-title="${c.body}" style="flex:none">→ Planen</button>` : ''}
            ${c.isMine ? html`<button class="link-btn" style="flex:none;color:var(--muted);font-weight:600;font-size:13px" data-action="delete-comment" data-id="${c.id}">Löschen</button>` : ''}
          </div>
        </div></div>`,
    )}</section>`;
}

export default async function postView({ id }, query) {
  const { post } = await api.post(id);
  remember(post);
  const meta = TYPE_META[post.type];
  const mapsHref = post.location ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(post.location)}` : null;

  const createdBanner = query.created
    ? html`<div class="banner ${tone(post.type)}">
        <h3>🎉 Ist drin!</h3>
        <p>Deine Gruppe sieht es jetzt. Schick's direkt in euren WhatsApp-Chat – dann geht's am schnellsten.</p>
        <div class="actions" style="margin:0">
          <a class="btn whatsapp" href="${whatsappHref(postShareText(post))}" target="_blank" rel="noopener">💬 WhatsApp</a>
          <button class="btn ghost" data-action="share-post" data-id="${post.id}">Mehr…</button>
        </div></div>`
    : '';

  return {
    html: html`
      <div class="${tone(post.type)}">
        <header class="topbar compact">
          <button class="icon-btn" data-action="close" aria-label="Zurück">←</button>
          <span style="flex:1"></span>
          <button class="icon-btn" data-action="share-post" data-id="${post.id}" aria-label="Teilen">📤</button>
          ${post.isMine ? html`<button class="icon-btn" data-action="menu" aria-label="Mehr">⋯</button>` : ''}
        </header>
        ${createdBanner}
        <section class="hero">
          <span class="kicker" style="background:var(--surface)">${meta.label}</span>
          <div class="emoji" aria-hidden="true">${post.emoji ?? meta.emoji}</div>
          <h1>${cardTitle(post)}</h1>
          <div class="when">${whenLabel(post.startsAt, post.endsAt)}</div>
          <div class="meta-line">${avatar(post.author, 'sm')}<span>${post.isMine ? 'Von dir' : `von ${post.author.name}`}</span></div>
          ${post.location ? html`<div class="meta-line">📍 <a href="${mapsHref}" target="_blank" rel="noopener">${post.location}</a></div>` : ''}
          ${post.description ? html`<p class="desc">${post.description}</p>` : ''}
          ${post.type === 'availability' ? ideaChips(post) : ''}
          ${helpProgress(post)}
          <div class="meta-line muted" style="font-size:13px">👥 ${post.groups.map((g) => `${g.emoji ?? ''} ${g.name}`).join(' · ')}</div>
        </section>
        ${actionArea(post)}
        ${participantList(post)}
        ${comments(post)}
        <div class="composer"><form data-submit="comment">
          <input class="input" name="body" placeholder="Kommentar schreiben…" maxlength="1000" autocomplete="off" enterkeyhint="send">
          <button type="submit" aria-label="Senden">➤</button>
        </form></div>
      </div>`,
    actions: {
      close: () => (query.created || history.length <= 1 ? navigate('/') : history.back()),
      status: async (el) => {
        vibrate();
        const status = el.dataset.status;
        if (post.myStatus === status) {
          await api.unparticipate(post.id);
          toast('Ausgetragen');
        } else {
          await api.participate(post.id, status);
          toast({ going: 'Du bist dabei 🙌', maybe: 'Vielleicht – okay!', declined: 'Schade! Danke fürs Bescheidgeben', free: 'Ihr seid beide frei 🙌', helping: 'Danke, dass du hilfst 💛', accepting: 'Angefragt 👍' }[status]);
        }
        rerender();
      },
      comment: async (form) => {
        const body = form.body.value.trim();
        if (!body) return;
        await api.comment(post.id, body);
        form.body.value = '';
        await rerender();
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      },
      'delete-comment': async (el) => {
        await api.deleteComment(el.dataset.id);
        rerender();
      },
      'plan-from': (el) => {
        const start = dateParts(post.startsAt);
        const params = new URLSearchParams({ date: start.date, start: start.time });
        if (post.endsAt) params.set('end', dateParts(post.endsAt).time);
        if (el.dataset.title) params.set('title', el.dataset.title);
        navigate(`/new/activity?${params}`);
      },
      menu: () =>
        openSheet(
          html`<h2>${cardTitle(post)}</h2><div class="stack">
            <button class="btn ghost block lg" data-action="share">📤 Teilen</button>
            <button class="btn danger block lg" data-action="cancel-post">Absagen & löschen</button></div>`,
          {
            share: () => sharePost(post),
            'cancel-post': async () => {
              const ok = await confirmSheet({
                title: 'Wirklich absagen?',
                text: 'Alle, die dabei sind, sehen den Eintrag dann nicht mehr.',
                confirmLabel: 'Absagen & löschen',
              });
              if (!ok) return;
              await api.cancelPost(post.id);
              toast('Abgesagt');
              navigate('/', { replace: true });
            },
          },
        ),
    },
  };
}
