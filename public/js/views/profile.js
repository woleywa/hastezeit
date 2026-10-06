import { api } from '../api.js';
import { store } from '../store.js';
import { html, avatar, openSheet, closeSheet, toast, $$ } from '../ui.js';
import { navigate } from '../router.js';
import { postCard, remember } from '../components.js';
import { AVATAR_COLORS, POSITIVE_STATUS } from '/shared/constants.js';

const EMOJIS = ['😎', '🌻', '💪', '🚲', '🎸', '🧗', '🎲', '🎬', '🐻', '🦊', '🐼', '🌈', '⚡', '🍕', '🎾', '☕'];

function openEditSheet() {
  const u = store.user;
  const draft = { emoji: u.emoji, color: u.color };
  openSheet(
    html`<h2>Profil bearbeiten</h2>
      <form data-submit="save-profile" class="form">
        <input class="input big" name="name" value="${u.name}" maxlength="40" autocomplete="name" required>
        <div><span class="label">Emoji</span><div class="emoji-pick">${EMOJIS.map((e) => html`<button type="button" class="${e === u.emoji ? 'on' : ''}" data-action="pick-emoji" data-emoji="${e}">${e}</button>`)}</div></div>
        <div><span class="label">Farbe</span><div class="color-pick">${AVATAR_COLORS.map((c) => html`<button type="button" class="${c === u.color ? 'on' : ''}" style="--c:${c}" data-action="pick-color" data-color="${c}" aria-label="Farbe ${c}"></button>`)}</div></div>
        <button class="btn dark block lg" type="submit">Speichern</button>
      </form>`,
    {
      'pick-emoji': (el) => {
        draft.emoji = el.dataset.emoji;
        $$('.emoji-pick button').forEach((b) => b.classList.toggle('on', b === el));
      },
      'pick-color': (el) => {
        draft.color = el.dataset.color;
        $$('.color-pick button').forEach((b) => b.classList.toggle('on', b === el));
      },
      'save-profile': async (form) => {
        store.apply(await api.updateMe({ name: form.name.value, ...draft }));
        closeSheet();
        toast('Gespeichert');
        navigate('/profile', { replace: true });
      },
    },
  );
}

export default async function profileView() {
  const { posts } = await api.posts();
  remember(posts);
  const mine = posts.filter((p) => p.isMine || p.myStatus === POSITIVE_STATUS[p.type] || p.myStatus === 'maybe');
  const u = store.user;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);

  return {
    html: html`
      <div class="profile-head">
        ${avatar(u, 'lg')}
        <h1>${u.name}</h1>
        <div class="muted">${u.email ?? ''}</div>
        <button class="btn ghost sm" data-action="edit" style="margin-top:12px">Bearbeiten</button>
      </div>

      <section class="section"><h2 class="section-title"><span>Meine Pläne</span><span>${mine.length}</span></h2>
        ${mine.length ? mine.map(postCard) : html`<p class="hint">Noch nichts geplant. Tipp auf ＋ und leg los.</p>`}
      </section>

      ${standalone
        ? ''
        : html`<section class="section"><div class="install-tip">📲 <strong>Als App installieren:</strong>
            ${ios ? 'In Safari auf „Teilen“ und dann „Zum Home-Bildschirm“ tippen.' : 'Im Browser-Menü „App installieren“ bzw. „Zum Startbildschirm hinzufügen“ wählen.'}</div></section>`}

      <section class="section stack">
        ${u.isDemo ? html`<button class="btn soft block lg tone-activity" data-action="switch">🔁 Als andere Person ansehen</button>` : ''}
        ${store.app.webDemo ? html`<button class="btn ghost block lg" data-action="reset-demo">↺ Demo zurücksetzen</button>` : ''}
        <button class="btn ghost block lg" data-action="logout">Abmelden</button>
      </section>
      <p class="center muted" style="font-size:13px;margin-top:24px">${store.app.name} · privat · Open Source</p>`,
    actions: {
      edit: openEditSheet,
      switch: async () => {
        await api.logout();
        store.user = null;
        navigate('/login');
      },
      'reset-demo': async () => {
        await api.resetDemo();
        await store.refresh();
        toast('Demo zurückgesetzt');
        navigate('/login', { replace: true });
      },
      logout: async () => {
        await api.logout();
        await store.refresh();
        navigate('/login', { replace: true });
      },
    },
  };
}
