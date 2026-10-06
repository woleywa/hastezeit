// Global client state: the logged-in user, their groups and app config. Everything else is
// fetched per view (small app, few users – no client cache needed).
import { api } from './api.js';

export const store = {
  user: null,
  groups: [],
  unread: 0,
  app: { name: 'Bock', demoMode: false },
  demoUsers: [],

  apply(me) {
    this.user = me.user;
    this.groups = me.groups ?? [];
    this.unread = me.unread ?? 0;
    this.app = me.app ?? this.app;
    this.demoUsers = me.demoUsers ?? [];
    document.title = this.app.name;
    return this;
  },

  async refresh() {
    return this.apply(await api.me());
  },
};

// Small per-device preferences (never relied upon – wrapped in try/catch for private mode).
export const prefs = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`bock:${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`bock:${key}`, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};
