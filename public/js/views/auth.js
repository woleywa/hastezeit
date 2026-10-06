// Welcome/login, invite links (/i/CODE → #/invite/CODE) and share links (/e/CODE → #/e/CODE).
import { api } from '../api.js';
import { store } from '../store.js';
import { html, avatar, toast } from '../ui.js';
import { navigate, takeNext } from '../router.js';
import { tone } from '../components.js';
import { TYPE_META, POSITIVE_STATUS } from '/shared/constants.js';
import { whenLabel, joinNames } from '/shared/format.js';

/** Login or register form. `extra` is merged into the register payload (inviteCode / shareCode). */
function authForm(mode, { submitLabel } = {}) {
  const register = mode === 'register';
  return html`<form class="form" data-submit="auth" data-mode="${mode}" style="gap:12px">
      ${register ? html`<input class="input" name="name" placeholder="Dein Vorname" autocomplete="given-name" maxlength="40" required>` : ''}
      <input class="input" name="email" type="email" placeholder="E-Mail" autocomplete="email" required>
      <input class="input" name="password" type="password" placeholder="${register ? 'Passwort (mind. 6 Zeichen)' : 'Passwort'}"
        autocomplete="${register ? 'new-password' : 'current-password'}" minlength="${register ? 6 : 1}" required>
      <button class="btn dark block lg" type="submit">${submitLabel ?? (register ? 'Konto erstellen' : 'Einloggen')}</button>
      <button type="button" class="link-btn" data-action="toggle-mode" style="color:var(--muted)">
        ${register ? 'Schon ein Konto? Einloggen' : 'Neu hier? Konto erstellen'}</button>
    </form>`;
}

async function submitAuth(form, extra = {}) {
  const data = Object.fromEntries(new FormData(form));
  const me = form.dataset.mode === 'register' ? await api.register({ ...data, ...extra }) : await api.login(data.email, data.password);
  store.apply(me);
}

export function loginView() {
  if (store.user) return navigate(takeNext(), { replace: true });
  let mode = 'login';
  const render = () => html`
    <div class="welcome">
      <div class="logo-big">🤙</div>
      <h1>${store.app.name}</h1>
      <p class="tagline">Weniger Hin und Her im Gruppenchat.<br>Mehr Zeit mit Freunden.</p>
      <div class="pillars">
        <div class="pillar tone-time"><span class="p-emoji">🕐</span>Wer hat wann Zeit?</div>
        <div class="pillar tone-activity"><span class="p-emoji">🎯</span>Wer hat worauf Bock?</div>
        <div class="pillar tone-help"><span class="p-emoji">🤝</span>Wer braucht Hilfe?</div>
      </div>
      ${store.app.demoMode && store.demoUsers.length
        ? html`<span class="label">Demo ansehen als …</span>
          <div class="demo-grid">${store.demoUsers.map((u) => html`<button data-action="demo" data-id="${u.id}">${avatar(u, 'md')}${u.name}</button>`)}</div>
          <div class="divider">oder mit E-Mail</div>`
        : ''}
      <div id="auth-box">${authForm(mode)}</div>
      ${store.app.openSignup ? '' : html`<p class="hint center" style="margin-top:16px">Neu hier? Am einfachsten über einen Einladungslink von deinen Freunden.</p>`}
    </div>`;

  return {
    html: render(),
    actions: {
      demo: async (el) => {
        store.apply(await api.demoLogin(el.dataset.id));
        navigate(takeNext(), { replace: true });
      },
      'toggle-mode': () => {
        mode = mode === 'login' ? 'register' : 'login';
        document.getElementById('auth-box').innerHTML = String(authForm(mode));
      },
      auth: async (form) => {
        await submitAuth(form);
        navigate(takeNext(), { replace: true });
      },
    },
  };
}

export async function inviteView({ code }) {
  const { invite, isMember } = await api.invite(code);
  const inviter = invite.inviter?.name ?? 'Jemand';
  let mode = 'register';

  const finish = async () => {
    await store.refresh();
    toast(`Willkommen in ${invite.name} 🎉`);
    navigate('/', { replace: true });
  };

  const head = html`<div class="welcome center" style="padding-top:4dvh">
      <div class="logo-big">${invite.emoji ?? '👥'}</div>
      <p class="muted" style="margin:14px 0 0">${inviter} lädt dich ein</p>
      <h1 style="font-size:34px;margin-top:4px">${invite.name}</h1>
      <p class="tagline" style="font-size:16px">${invite.memberCount} ${invite.memberCount === 1 ? 'Person ist' : 'Leute sind'} schon dabei. Sieh, wer wann Zeit hat, was geht und wo jemand Hilfe braucht.</p>
    </div>`;

  let body;
  if (store.user && isMember) {
    body = html`<p class="center">Du bist schon in dieser Gruppe 🙂</p><a class="btn dark block lg" href="#/">Zum Feed</a>`;
  } else if (store.user) {
    body = html`<button class="btn dark block lg" data-action="join">Gruppe beitreten</button>
      <p class="hint center">Angemeldet als ${store.user.name}</p>`;
  } else {
    body = html`<div id="auth-box">${authForm(mode, { submitLabel: 'Beitreten' })}</div>`;
  }

  return {
    html: html`${head}<div style="margin-top:8px">${body}</div>`,
    actions: {
      join: async () => {
        await api.acceptInvite(code);
        await finish();
      },
      'toggle-mode': () => {
        mode = mode === 'login' ? 'register' : 'login';
        document.getElementById('auth-box').innerHTML = String(authForm(mode, { submitLabel: mode === 'register' ? 'Beitreten' : 'Einloggen & beitreten' }));
      },
      auth: async (form) => {
        await submitAuth(form, { inviteCode: code });
        if (form.dataset.mode === 'login') await api.acceptInvite(code);
        await finish();
      },
    },
  };
}

const CTA = { activity: 'Bin dabei', availability: 'Bin auch frei', help_request: 'Ich helfe', help_offer: 'Nehm ich gern' };
const PHRASE = {
  going: ['ist auch dabei', 'sind auch dabei'],
  free: ['ist auch frei', 'sind auch frei'],
  helping: ['hilft mit', 'helfen mit'],
  accepting: ['ist interessiert', 'sind interessiert'],
};

export async function shareLinkView({ code }, query) {
  const { preview, postId } = await api.share(code);

  if (store.user) {
    if (query.join && !preview.cancelled) {
      const { post } = await api.joinShare(code);
      toast(post.isMine ? 'Das ist dein Eintrag 🙂' : `${CTA[preview.type]} – eingetragen 🙌`);
      return navigate(`/post/${post.id}`, { replace: true });
    }
    if (postId) return navigate(`/post/${postId}`, { replace: true });
  }

  const meta = TYPE_META[preview.type];
  const [one, many] = PHRASE[POSITIVE_STATUS[preview.type]];
  const others = preview.positiveNames.length
    ? `${joinNames(preview.positiveNames, 3)} ${preview.positiveNames.length === 1 ? one : many}`
    : '';
  let mode = 'register';
  const doJoin = async () => {
    const { post } = await api.joinShare(code);
    toast('Eingetragen 🙌');
    navigate(`/post/${post.id}`, { replace: true });
  };

  return {
    html: html`
      <div class="${tone(preview.type)}" style="padding-top:12px">
        <section class="hero">
          <span class="kicker" style="background:var(--surface)">${meta.label}</span>
          <div class="emoji">${preview.emoji ?? meta.emoji}</div>
          <h1>${preview.type === 'availability' ? `${preview.author.name} hat Zeit` : preview.title}</h1>
          <div class="when">${whenLabel(preview.startsAt, preview.endsAt)}</div>
          ${preview.location ? html`<div class="meta-line">📍 ${preview.location}</div>` : ''}
          ${preview.description ? html`<p class="desc">„${preview.description}“</p>` : ''}
          <p class="desc"><strong>${preview.type === 'activity' ? `${preview.author.name} ist dabei.` : `von ${preview.author.name}`}</strong>${others ? html`<br>${others}` : ''}</p>
        </section>
        ${preview.cancelled
          ? html`<p class="center" style="margin-top:20px">Dieser Eintrag wurde abgesagt 🙈</p>`
          : store.user
            ? html`<button class="btn block lg" data-action="join" style="margin-top:16px">${CTA[preview.type]}</button>`
            : html`<p class="center muted" style="margin:20px 0 12px">Kurz anmelden, damit ${preview.author.name} weiß, wer kommt:</p>
                <div id="auth-box">${authForm(mode, { submitLabel: CTA[preview.type] })}</div>`}
      </div>`,
    actions: {
      join: doJoin,
      'toggle-mode': () => {
        mode = mode === 'login' ? 'register' : 'login';
        document.getElementById('auth-box').innerHTML = String(authForm(mode, { submitLabel: mode === 'register' ? CTA[preview.type] : 'Einloggen' }));
      },
      auth: async (form) => {
        await submitAuth(form, { shareCode: code });
        await doJoin();
      },
    },
  };
}
