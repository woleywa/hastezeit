// App bootstrap: hash router, delegated actions, tab bar, polling.
import { api, ApiError } from './api.js';
import { store } from './store.js';
import { html, toast, openSheet, closeSheet, currentSheetActions, sheetOpen, vibrate } from './ui.js';
import { postCache, chooserContent, updateBadges } from './components.js';
import { sharePost } from './share.js';
import { setRenderer, parseHash, navigate, rerender } from './router.js';

import feedView from './views/feed.js';
import timesView, { roundView } from './views/times.js';
import weekView from './views/week.js';
import postView, { openSuggestSheet } from './views/post.js';
import createView, { chooserView } from './views/create.js';
import groupsView, { groupDetailView } from './views/groups.js';
import profileView from './views/profile.js';
import notificationsView from './views/notifications.js';
import { loginView, inviteView, shareLinkView } from './views/auth.js';

const ROUTES = [
  ['/', feedView, { tab: 'home' }],
  ['/zeiten', timesView, { tab: 'times' }],
  ['/round/:groupId/:date/:part', roundView, { nav: false }],
  ['/week', weekView, { tab: 'times' }],
  ['/new', chooserView, { nav: false }],
  ['/new/:kind', createView, { nav: false }],
  ['/post/:id', postView, { nav: false }],
  ['/groups', groupsView, { tab: 'groups' }],
  ['/groups/:id', groupDetailView, { tab: 'groups' }],
  ['/profile', profileView, { tab: 'profile' }],
  ['/notifications', notificationsView, { tab: 'home' }],
  ['/login', loginView, { public: true, nav: false }],
  ['/invite/:code', inviteView, { public: true, nav: false }],
  ['/e/:code', shareLinkView, { public: true, nav: false }],
].map(([pattern, view, opts]) => {
  const keys = [];
  const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
  return { regex, keys, view, ...opts };
});

const viewEl = document.getElementById('view');
const tabbarEl = document.getElementById('tabbar');
let current = { actions: {}, path: null };

async function render({ keepScroll = false } = {}) {
  const { path, query } = parseHash();
  const route = ROUTES.find((r) => r.regex.test(path)) ?? ROUTES[0];
  const params = {};
  const m = route.regex.exec(path);
  if (m) route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));

  if (!route.public && !store.user) {
    try {
      sessionStorage.setItem('bock:next', `${path}${location.hash.includes('?') ? '?' + location.hash.split('?')[1] : ''}`);
    } catch {
      /* storage blocked – login just lands on the feed */
    }
    return navigate('/login', { replace: true });
  }

  const scrollY = window.scrollY;
  const samePath = current.path === path;
  try {
    const result = await route.view(params, query);
    if (parseHash().path !== path) return; // user navigated away meanwhile
    if (!result) return;
    current = { ...result, path, route };
    viewEl.className = `view ${route.nav === false ? 'no-nav' : ''}`;
    viewEl.innerHTML = String(result.html);
    renderTabbar(route);
    result.mount?.(viewEl);
    window.scrollTo(0, keepScroll && samePath ? scrollY : 0);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      store.user = null;
      return navigate('/login', { replace: true });
    }
    viewEl.innerHTML = String(html`<div class="topbar compact"><a class="icon-btn" href="#/">←</a></div>
      <div class="empty"><div class="e-emoji">🙈</div><h3>Ups</h3><p>${err.message}</p>
      <a class="btn dark" href="#/">Zum Feed</a></div>`);
    renderTabbar(route);
  }
}

setRenderer(render);

function renderTabbar(route) {
  tabbarEl.hidden = route.nav === false || !store.user;
  if (tabbarEl.hidden) return;
  const tab = (id, href, icon, label) =>
    html`<a class="tab ${route.tab === id ? 'on' : ''}" href="${href}" data-action="tab" data-tab="${id}">
      <span class="t-icon">${icon}</span>${label}</a>`;
  tabbarEl.innerHTML = String(html`
    ${tab('home', '#/', '🏠', 'Home')}
    ${tab('times', '#/zeiten', '🗓️', 'Zeiten')}
    <div class="tab-plus"><button data-action="plus" aria-label="Neuer Eintrag">+</button></div>
    ${tab('groups', '#/groups', '👥', 'Gruppen')}
    ${tab('profile', '#/profile', '🙂', 'Profil')}`);
}

// ---- Global actions (available from every view) --------------------------------------------------
const CONFIRM_TEXT = {
  going: 'Du bist dabei 🙌',
  maybe: 'Als „Vielleicht“ markiert',
  declined: 'Abgesagt',
  free: 'Eingetragen – ihr seid beide frei 🙌',
  helping: 'Danke, dass du hilfst 💛',
  accepting: 'Angefragt 👍',
};

const globalActions = {
  plus: () => {
    vibrate();
    openSheet(chooserContent());
  },
  new: (el) => {
    closeSheet();
    if (el.dataset.kind === 'slots') return navigate('/zeiten');
    navigate(`/new/${el.dataset.kind}${el.dataset.query ? `?${el.dataset.query}` : ''}`);
  },
  tab: (el, e) => {
    // Tapping the active tab again refreshes and scrolls to top.
    if (current.route?.tab === el.dataset.tab && parseHash().path === el.getAttribute('href').slice(1)) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      render({ keepScroll: false });
    }
  },
  'open-post': (el) => navigate(`/post/${el.dataset.id}`),
  'open-round': (el) => navigate(el.dataset.href),
  'join-round': async (el) => {
    vibrate();
    await api.setSlot(el.dataset.date, el.dataset.part, true);
    toast('Du bist dabei 🙌');
    await rerender();
  },
  participate: async (el) => {
    vibrate();
    await api.participate(el.dataset.id, el.dataset.status);
    toast(CONFIRM_TEXT[el.dataset.status]);
    await rerender();
  },
  unparticipate: async (el) => {
    const id = el.dataset.id;
    const previous = postCache.get(id)?.myStatus;
    await api.unparticipate(id);
    toast('Ausgetragen', {
      action: previous ? 'Rückgängig' : null,
      onAction: async () => {
        await api.participate(id, previous);
        rerender();
      },
    });
    await rerender();
  },
  'share-post': (el) => {
    const post = postCache.get(el.dataset.id);
    if (post) sharePost(post);
  },
  suggest: (el) => {
    const post = postCache.get(el.dataset.id);
    if (post) openSuggestSheet(post);
  },
  back: () => (history.length > 1 ? history.back() : navigate('/')),
};

async function runAction(handler, el, e) {
  if (el.dataset.busy) return;
  el.dataset.busy = '1';
  const isButton = el.tagName === 'BUTTON';
  if (isButton) el.disabled = true;
  try {
    await handler(el, e);
  } catch (err) {
    toast(err.message ?? 'Fehler');
    if (err instanceof ApiError && err.status === 401) navigate('/login');
  } finally {
    delete el.dataset.busy;
    if (isButton && el.isConnected) el.disabled = false;
  }
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-sheet-close]') && !e.target.closest('[data-action]')) return closeSheet();
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const name = el.dataset.action;
  const inSheet = Boolean(el.closest('#sheet-root'));
  const handler = (inSheet && currentSheetActions()?.[name]) || current.actions?.[name] || globalActions[name];
  if (!handler) return;
  if (el.tagName !== 'A') e.preventDefault();
  e.stopPropagation();
  runAction(handler, el, e);
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  const name = form.dataset.submit;
  if (!name) return;
  e.preventDefault();
  const inSheet = Boolean(form.closest('#sheet-root'));
  const handler = (inSheet && currentSheetActions()?.[name]) || current.actions?.[name];
  if (handler) runAction(handler, form, e);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheetOpen()) closeSheet();
});

window.addEventListener('hashchange', () => {
  closeSheet();
  render();
});

// Keep notification badge fresh and refresh lists when the app comes back to the foreground.
async function poll() {
  if (document.hidden || !store.user) return;
  try {
    const { unread } = await api.me();
    store.unread = unread;
    updateBadges();
  } catch {
    /* offline – ignore */
  }
}
setInterval(poll, 30_000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !store.user) return;
  poll();
  if (['home', 'times'].includes(current.route?.tab) && !sheetOpen()) rerender();
});

// ---- Boot ---------------------------------------------------------------------------------------
async function boot() {
  try {
    await store.refresh();
  } catch (err) {
    viewEl.innerHTML = String(html`<div class="empty"><div class="e-emoji">📡</div><h3>Keine Verbindung</h3><p>${err.message}</p>
      <button class="btn dark" onclick="location.reload()">Nochmal versuchen</button></div>`);
    return;
  }
  await render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !store.app.webDemo) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

boot();
