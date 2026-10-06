// Navigation helpers shared by app.js and the views (kept separate to avoid circular imports).
let renderFn = async () => {};
export const setRenderer = (fn) => (renderFn = fn);

export function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = h.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs)) };
}

export function navigate(to, { replace = false } = {}) {
  const target = `#${to}`;
  if (location.hash === target) return renderFn();
  if (replace) {
    try {
      history.replaceState(null, '', target);
    } catch {
      location.hash = target; // some embedded views refuse replaceState
      return;
    }
    return renderFn();
  }
  location.hash = target;
}

export const rerender = () => renderFn({ keepScroll: true });

/** Where to go after login/registration (e.g. back to an invite or share link). */
export function takeNext(fallback = '/') {
  let next = null;
  try {
    next = sessionStorage.getItem('bock:next');
    sessionStorage.removeItem('bock:next');
  } catch {
    /* storage blocked */
  }
  return next && next !== '/login' ? next : fallback;
}
