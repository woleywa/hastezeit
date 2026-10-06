// In-browser stand-in for the HTTP API, used only by the hosted web demo (see demo/build.mjs).
// Same method names, response shapes and domain rules as server/domain/*, data kept in the
// visitor's own browser (localStorage). Every visitor gets their own demo world.
import { ApiError } from '../public/js/api.js';
import { POST_TYPES, PARTICIPATION_BY_TYPE, POSITIVE_STATUS, AVATAR_COLORS, LIMITS, DAYPARTS, DAYPART_IDS, SLOT_DAYS_AHEAD } from '../shared/constants.js';
import { computeRounds } from '../shared/rounds.js';
import { dateParts, addDays } from '../shared/time.js';
import { guessEmoji } from '../shared/emoji.js';
import { firstName } from '../shared/format.js';
import { seedScenario } from '../server/demo-scenario.js';

export { ApiError };

const KEY = 'bock-web-demo-v3'; // bump when the demo scenario changes → visitors get a fresh seed
const TZ = 'Europe/Berlin';
const RESEED_AFTER_MS = 3 * 86400_000; // keep the demo week current
const HOUR = 3600_000;
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const rid = (n = 10) => {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
};
const nowIso = () => new Date().toISOString();
const fail = (status, message) => {
  throw new ApiError(status, message);
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const clean = (v, max, field, required = false) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return required ? fail(400, `${field} fehlt.`) : null;
  if (s.length > max) fail(400, `${field} ist zu lang (max. ${max} Zeichen).`);
  return s;
};

const empty = () => ({ users: [], groups: [], members: [], posts: [], participants: [], comments: [], notifications: [], slots: [], roundMessages: [], session: null, seededAt: null });
let db = empty();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* private mode – demo still works for this visit */
  }
}

const publicUser = (u) => (u ? { id: u.id, name: u.name, emoji: u.emoji, color: u.color } : null);
const userById = (id) => db.users.find((u) => u.id === id);
const isMember = (uid, gid) => db.members.some((m) => m.userId === uid && m.groupId === gid);

// ---- services (mirror server/domain) -------------------------------------------------------
function notify({ userIds, type, postId = null, actorId = null, data = {}, dedupeKey }) {
  for (const uid of new Set(userIds)) {
    if (!uid || uid === actorId) continue;
    const key = dedupeKey?.(uid) ?? null;
    if (key && db.notifications.some((n) => n.dedupeKey === key)) continue;
    db.notifications.push({ id: rid(), userId: uid, type, postId, actorId, data, dedupeKey: key, createdAt: nowIso(), readAt: null });
  }
}

const users = {
  async register({ name, email, password, emoji = null, color = null, isDemo = false }) {
    name = clean(name, LIMITS.userName, 'Name', true);
    email = clean(email, 200, 'E-Mail', true).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Bitte eine gültige E-Mail angeben.');
    if (typeof password !== 'string' || password.length < 6) fail(400, 'Passwort: mindestens 6 Zeichen.');
    if (db.users.some((u) => u.email === email)) fail(409, 'Diese E-Mail ist schon registriert. Bitte einloggen.');
    const user = {
      id: rid(12), name, email, password, emoji,
      color: color ?? AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
      isDemo, createdAt: nowIso(),
    };
    db.users.push(user);
    return user;
  },
};

function serializeGroup(g) {
  return {
    id: g.id, name: g.name, emoji: g.emoji, inviteCode: g.inviteCode,
    members: db.members.filter((m) => m.groupId === g.id).map((m) => ({ ...publicUser(userById(m.userId)), role: m.role })),
  };
}

const groups = {
  create(uid, { name, emoji }) {
    const g = { id: rid(12), name: clean(name, LIMITS.groupName, 'Gruppenname', true), emoji: clean(emoji, 16, 'Emoji') ?? '👥', inviteCode: rid(10), createdBy: uid, createdAt: nowIso() };
    db.groups.push(g);
    db.members.push({ groupId: g.id, userId: uid, role: 'admin', joinedAt: g.createdAt });
    return serializeGroup(g);
  },
  addMember(gid, uid, role = 'member') {
    if (!isMember(uid, gid)) db.members.push({ groupId: gid, userId: uid, role, joinedAt: nowIso() });
  },
  get(uid, gid) {
    const g = db.groups.find((x) => x.id === gid) ?? fail(404, 'Gruppe nicht gefunden.');
    if (!isMember(uid, gid)) fail(403, 'Du bist nicht in dieser Gruppe.');
    return serializeGroup(g);
  },
  list: (uid) => db.groups.filter((g) => isMember(uid, g.id)).map(serializeGroup),
  byCode: (code) => db.groups.find((g) => g.inviteCode === code) ?? fail(404, 'Dieser Einladungslink ist ungültig oder abgelaufen.'),
};

const visible = (uid, p) =>
  p.authorId === uid || p.groupIds.some((g) => isMember(uid, g)) || db.participants.some((x) => x.postId === p.id && x.userId === uid);

function requireVisible(uid, id) {
  const p = db.posts.find((x) => x.id === id);
  if (!p || p.cancelledAt) fail(404, 'Diesen Eintrag gibt es nicht (mehr).');
  if (!visible(uid, p)) fail(403, 'Dieser Eintrag ist nur für die Gruppe sichtbar.');
  return p;
}

function serializePost(p, viewerId) {
  const participants = db.participants
    .filter((x) => x.postId === p.id)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .map((x) => ({ user: publicUser(userById(x.userId)), status: x.status }));
  const counts = {};
  for (const { status } of participants) counts[status] = (counts[status] ?? 0) + 1;
  return {
    id: p.id, type: p.type, title: p.title, description: p.description, emoji: p.emoji,
    startsAt: p.startsAt, endsAt: p.endsAt, location: p.location, capacity: p.capacity, ideas: p.ideas,
    shareCode: p.shareCode, source: p.source,
    author: publicUser(userById(p.authorId)),
    groups: p.groupIds.map((gid) => db.groups.find((g) => g.id === gid)).filter(Boolean).map(({ id, name, emoji }) => ({ id, name, emoji })),
    participants, counts,
    positiveCount: counts[POSITIVE_STATUS[p.type]] ?? 0,
    myStatus: participants.find((x) => x.user.id === viewerId)?.status ?? null,
    isMine: p.authorId === viewerId,
    commentCount: db.comments.filter((c) => c.postId === p.id).length,
    createdAt: p.createdAt,
  };
}

const posts = {
  create(uid, input) {
    if (!POST_TYPES.includes(input.type)) fail(400, 'Unbekannter Typ.');
    let title = clean(input.title, LIMITS.title, 'Titel');
    if (!title) title = input.type === 'availability' ? 'Hab Zeit' : fail(400, 'Was habt ihr vor? Bitte einen Titel angeben.');
    const start = Date.parse(input.startsAt);
    if (Number.isNaN(start)) fail(400, 'Startzeit fehlt.');
    const end = input.endsAt ? Date.parse(input.endsAt) : null;
    if (end !== null && end <= start) fail(400, 'Das Ende muss nach dem Start liegen.');
    if (start < Date.now() - 12 * HOUR) fail(400, 'Der Termin liegt in der Vergangenheit.');
    const groupIds = [...new Set(input.groupIds ?? [])];
    if (!groupIds.length) fail(400, 'Bitte mindestens eine Gruppe auswählen.');
    if (!groupIds.every((g) => isMember(uid, g))) fail(403, 'Du kannst nur in deine eigenen Gruppen posten.');
    const capacity = input.capacity ? Number(input.capacity) : null;
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) fail(400, 'Anzahl Personen ist ungültig.');
    const ideas = input.type === 'availability' && Array.isArray(input.ideas) ? input.ideas.slice(0, LIMITS.ideas) : [];
    const description = clean(input.description, LIMITS.description, 'Beschreibung');
    const p = {
      id: rid(12), type: input.type, authorId: uid, title, description,
      emoji: clean(input.emoji, 16, 'Emoji') ?? (input.type === 'availability' ? ideas[0]?.split(' ')[0] ?? '👋' : guessEmoji(`${title} ${description ?? ''}`, input.type)),
      startsAt: new Date(start).toISOString(),
      endsAt: end ? new Date(end).toISOString() : null,
      untilAt: new Date(end ?? start + 3 * HOUR).toISOString(),
      location: clean(input.location, LIMITS.location, 'Ort'),
      capacity, ideas, shareCode: rid(8), source: input.source ?? 'app', rawInput: input.rawInput ?? null,
      groupIds, createdAt: nowIso(), cancelledAt: null,
    };
    db.posts.push(p);
    if (p.type !== 'availability') {
      const recipients = db.members.filter((m) => groupIds.includes(m.groupId)).map((m) => m.userId);
      notify({ userIds: recipients, type: 'post_created', postId: p.id, actorId: uid, data: { postType: p.type } });
    }
    return posts.get(uid, p.id);
  },

  list(uid, { from, to, groupId, type } = {}) {
    const fromIso = from ? new Date(from).toISOString() : nowIso();
    const toIso = to ? new Date(to).toISOString() : null;
    if (groupId && !isMember(uid, groupId)) fail(403, 'Du bist nicht in dieser Gruppe.');
    const types = type ? (type === 'help' ? ['help_request', 'help_offer'] : [type]) : null;
    return db.posts
      .filter((p) => !p.cancelledAt && p.untilAt >= fromIso && (!toIso || p.startsAt < toIso))
      .filter((p) => visible(uid, p))
      .filter((p) => !groupId || p.groupIds.includes(groupId))
      .filter((p) => !types || types.includes(p.type))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map((p) => serializePost(p, uid));
  },

  get(uid, id) {
    const p = requireVisible(uid, id);
    const post = serializePost(p, uid);
    post.comments = db.comments
      .filter((c) => c.postId === id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((c) => ({ id: c.id, kind: c.kind, body: c.body, createdAt: c.createdAt, user: publicUser(userById(c.userId)), isMine: c.userId === uid }));
    return post;
  },

  setParticipation(uid, id, status, { viaShare = false } = {}) {
    const p = viaShare ? db.posts.find((x) => x.id === id) : requireVisible(uid, id);
    if (!p || p.cancelledAt) fail(404, 'Diesen Eintrag gibt es nicht (mehr).');
    if (p.authorId === uid) fail(400, 'Das ist dein eigener Eintrag 🙂');
    if (!PARTICIPATION_BY_TYPE[p.type].includes(status)) fail(400, 'Ungültiger Status.');
    const existing = db.participants.find((x) => x.postId === id && x.userId === uid);
    if (existing?.status === status) return posts.get(uid, id);
    if (status === POSITIVE_STATUS[p.type] && p.capacity) {
      const n = db.participants.filter((x) => x.postId === id && x.status === status && x.userId !== uid).length;
      if (n >= p.capacity) fail(409, p.type === 'help_request' ? 'Es sind schon genug Helfer:innen da 🎉' : 'Leider schon voll.');
    }
    if (existing) Object.assign(existing, { status, updatedAt: nowIso() });
    else db.participants.push({ postId: id, userId: uid, status, createdAt: nowIso(), updatedAt: nowIso() });
    if (status !== 'declined') notify({ userIds: [p.authorId], type: 'participation', postId: id, actorId: uid, data: { status } });
    return posts.get(uid, id);
  },

  addComment(uid, id, { body, kind = 'comment' }) {
    const p = requireVisible(uid, id);
    const text = clean(body, LIMITS.comment, 'Kommentar', true);
    db.comments.push({ id: rid(12), postId: id, userId: uid, kind, body: text, createdAt: nowIso() });
    const commenters = db.comments.filter((c) => c.postId === id).map((c) => c.userId);
    notify({ userIds: [p.authorId, ...commenters], type: kind === 'suggestion' ? 'suggestion' : 'comment', postId: id, actorId: uid, data: { preview: text.slice(0, 80) } });
    return posts.get(uid, id);
  },

  byShareCode: (code) => db.posts.find((p) => p.shareCode === code) ?? fail(404, 'Dieser Link ist ungültig.'),
};

// ---- "Wann hast du Zeit?" slots & automatic rounds (mirrors server/domain/slots.js) ----------
const todayStr = () => dateParts(new Date(), TZ).date;

function slotOverview(uid, { from, days = 14 } = {}) {
  const start = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : todayStr();
  const end = addDays(start, Math.min(Math.max(Number(days) || 14, 1), 28) - 1);
  const myGroups = groups.list(uid).map((g) => ({ ...g, memberIds: g.members.map((m) => m.id) }));
  const people = new Set(myGroups.flatMap((g) => g.memberIds).concat(uid));
  const slots = db.slots.filter((s) => s.date >= start && s.date <= end && people.has(s.userId));
  const users = new Map(myGroups.flatMap((g) => g.members).map((u) => [u.id, u]));
  const { rounds, cells } = computeRounds({ slots, groups: myGroups, viewerId: uid });
  return {
    from: start, to: end, today: todayStr(),
    mySlots: slots.filter((s) => s.userId === uid).map(({ date, part }) => ({ date, part })),
    cells: Object.fromEntries(Object.entries(cells).map(([k, c]) => [k, { mine: c.mine, friends: c.friendIds.map((id) => users.get(id)).filter(Boolean) }])),
    rounds: rounds.map((r) => ({
      ...r,
      members: r.memberIds.map((id) => users.get(id)),
      messageCount: db.roundMessages.filter((m) => m.groupId === r.group.id && m.date === r.date && m.part === r.part).length,
    })),
  };
}

function getRound(uid, groupId, date, part) {
  if (!DAYPART_IDS.includes(part)) fail(404, 'Diese Runde gibt es nicht.');
  const group = groups.get(uid, groupId);
  const freeIds = new Set(db.slots.filter((s) => s.date === date && s.part === part).map((s) => s.userId));
  return {
    group: { id: group.id, name: group.name, emoji: group.emoji }, date, part,
    daypart: DAYPARTS.find((d) => d.id === part),
    members: group.members.filter((m) => freeIds.has(m.id)),
    others: group.members.filter((m) => !freeIds.has(m.id)),
    includesMe: freeIds.has(uid),
    messages: db.roundMessages
      .filter((m) => m.groupId === groupId && m.date === date && m.part === part)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((m) => ({ id: m.id, body: m.body, createdAt: m.createdAt, user: publicUser(userById(m.userId)), isMine: m.userId === uid })),
  };
}

const slotService = {
  set(uid, { date, part, free }) {
    if (!DAYPART_IDS.includes(part)) fail(400, 'Unbekannte Tageszeit.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || date < todayStr() || date > addDays(todayStr(), SLOT_DAYS_AHEAD)) {
      fail(400, 'Bitte einen Tag in den nächsten 4 Wochen wählen.');
    }
    const exists = db.slots.some((s) => s.userId === uid && s.date === date && s.part === part);
    if (free && !exists) {
      db.slots.push({ userId: uid, date, part, createdAt: nowIso() });
      for (const r of slotOverview(uid, { from: date, days: 1 }).rounds.filter((x) => x.part === part && x.includesMe)) {
        notify({
          userIds: r.memberIds, type: 'match', actorId: uid,
          data: { groupId: r.group.id, groupName: r.group.name, date, part, count: r.memberIds.length },
          dedupeKey: (to) => `match:${r.group.id}:${date}:${part}:${uid}:${to}`,
        });
      }
    } else if (!free) {
      db.slots = db.slots.filter((s) => !(s.userId === uid && s.date === date && s.part === part));
    }
    return slotOverview(uid);
  },
  postMessage(uid, groupId, date, part, body) {
    const round = getRound(uid, groupId, date, part);
    const text = clean(body, LIMITS.comment, 'Nachricht', true);
    if (!round.includesMe) fail(403, 'Trag dich erst für diese Zeit ein, dann kannst du mitschreiben.');
    db.roundMessages.push({ id: rid(12), groupId, date, part, userId: uid, body: text, createdAt: nowIso() });
    notify({ userIds: round.members.map((m) => m.id), type: 'round_message', actorId: uid, data: { groupId, groupName: round.group.name, date, part, preview: text.slice(0, 80) } });
    return getRound(uid, groupId, date, part);
  },
};

// Demo reminders: same rule as the server job (starts within the next hour).
function runReminders() {
  const now = Date.now();
  for (const p of db.posts) {
    const t = Date.parse(p.startsAt);
    if (p.cancelledAt || p.type === 'availability' || t <= now || t > now + HOUR) continue;
    const attendees = db.participants.filter((x) => x.postId === p.id && x.status === POSITIVE_STATUS[p.type]).map((x) => x.userId);
    notify({ userIds: [p.authorId, ...attendees], type: 'reminder', postId: p.id, data: { startsAt: p.startsAt }, dedupeKey: (uid) => `reminder:${p.id}:${uid}` });
  }
}

// ---- boot ----------------------------------------------------------------------------------
async function seed() {
  db = empty();
  await seedScenario({ users, groups, posts, slots: slotService }, { tz: TZ });
  // Seeded notifications look nicer when they are a little spread out in time.
  db.notifications.forEach((n, i, all) => (n.createdAt = new Date(Date.now() - (all.length - i) * 7 * 60_000).toISOString()));
  db.seededAt = nowIso();
  persist();
}

const ready = (async () => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (saved?.seededAt && Date.now() - Date.parse(saved.seededAt) < RESEED_AFTER_MS) {
      db = saved;
      return;
    }
  } catch {
    /* storage unavailable or corrupt → fresh seed */
  }
  await seed();
})();

function current() {
  const u = db.session ? userById(db.session) : null;
  return u ?? fail(401, 'Bitte einloggen.');
}

/** Wraps an API method: waits for the seed, runs it, persists, returns a deep copy. */
const op = (fn) => async (...args) => {
  await ready;
  const result = await fn(...args);
  runReminders();
  persist();
  return clone(result ?? { ok: true });
};

function mePayload() {
  const u = db.session ? userById(db.session) : null;
  return {
    user: u ? { ...publicUser(u), email: u.email, isDemo: u.isDemo } : null,
    groups: u ? groups.list(u.id) : [],
    unread: u ? db.notifications.filter((n) => n.userId === u.id && !n.readAt).length : 0,
    app: { name: 'Bock', demoMode: true, tz: 'Europe/Berlin', openSignup: true, webDemo: true, publicUrl: 'https://bock.app' },
    demoUsers: u ? [] : db.users.filter((x) => x.isDemo).map(publicUser),
  };
}

function sharePreview(code) {
  const p = posts.byShareCode(code);
  const author = userById(p.authorId);
  return {
    id: p.id, code: p.shareCode, type: p.type, title: p.title, emoji: p.emoji, description: p.description,
    startsAt: p.startsAt, endsAt: p.endsAt, location: p.location, capacity: p.capacity, cancelled: Boolean(p.cancelledAt),
    author: { ...publicUser(author), name: firstName(author.name) },
    positiveNames: db.participants
      .filter((x) => x.postId === p.id && x.status === POSITIVE_STATUS[p.type])
      .map((x) => firstName(userById(x.userId).name)),
  };
}

export const api = {
  me: op(() => mePayload()),
  login: op((email, password) => {
    const u = db.users.find((x) => x.email === String(email ?? '').trim().toLowerCase());
    if (!u || u.password !== password) fail(401, 'E-Mail oder Passwort stimmt nicht.');
    db.session = u.id;
    return mePayload();
  }),
  register: op(async (data) => {
    const u = await users.register(data);
    if (data.inviteCode) groups.addMember(groups.byCode(data.inviteCode).id, u.id);
    db.session = u.id;
    return mePayload();
  }),
  demoLogin: op((userId) => {
    const u = userById(userId);
    if (!u?.isDemo) fail(400, 'Unbekannter Demo-User.');
    db.session = u.id;
    return mePayload();
  }),
  logout: op(() => {
    db.session = null;
  }),
  updateMe: op(({ name, emoji, color }) => {
    const u = current();
    if (name !== undefined) u.name = clean(name, LIMITS.userName, 'Name', true);
    if (emoji !== undefined) u.emoji = emoji;
    if (color !== undefined && AVATAR_COLORS.includes(color)) u.color = color;
    return mePayload();
  }),

  posts: op((params = {}) => ({ posts: posts.list(current().id, params) })),
  post: op((id) => ({ post: posts.get(current().id, id) })),
  createPost: op((data) => ({ post: posts.create(current().id, data) })),
  cancelPost: op((id) => {
    const uid = current().id;
    const p = requireVisible(uid, id);
    if (p.authorId !== uid) fail(403, 'Nur wer den Eintrag erstellt hat, kann ihn absagen.');
    p.cancelledAt = nowIso();
  }),
  participate: op((id, status) => ({ post: posts.setParticipation(current().id, id, status) })),
  unparticipate: op((id) => {
    const uid = current().id;
    requireVisible(uid, id);
    db.participants = db.participants.filter((x) => !(x.postId === id && x.userId === uid));
    return { post: posts.get(uid, id) };
  }),
  comment: op((id, body, kind = 'comment') => ({ post: posts.addComment(current().id, id, { body, kind }) })),
  deleteComment: op((commentId) => {
    const uid = current().id;
    const c = db.comments.find((x) => x.id === commentId) ?? fail(404, 'Kommentar nicht gefunden.');
    if (c.userId !== uid) fail(403, 'Du kannst nur eigene Kommentare löschen.');
    db.comments = db.comments.filter((x) => x.id !== commentId);
    return { post: posts.get(uid, c.postId) };
  }),

  share: op((code) => {
    const preview = sharePreview(code);
    const u = db.session ? userById(db.session) : null;
    const p = posts.byShareCode(code);
    return { preview, postId: u && visible(u.id, p) ? p.id : null };
  }),
  joinShare: op((code) => {
    const uid = current().id;
    const p = posts.byShareCode(code);
    if (p.authorId === uid) return { post: posts.get(uid, p.id) };
    return { post: posts.setParticipation(uid, p.id, POSITIVE_STATUS[p.type], { viaShare: true }) };
  }),

  groups: op(() => ({ groups: groups.list(current().id) })),
  group: op((id) => ({ group: groups.get(current().id, id) })),
  createGroup: op((data) => ({ group: groups.create(current().id, data) })),
  leaveGroup: op((id) => {
    const uid = current().id;
    if (!isMember(uid, id)) fail(400, 'Du bist nicht in dieser Gruppe.');
    db.members = db.members.filter((m) => !(m.groupId === id && m.userId === uid));
    if (!db.members.some((m) => m.groupId === id)) db.groups = db.groups.filter((g) => g.id !== id);
  }),
  invite: op((code) => {
    const g = groups.byCode(code);
    const inviter = userById(g.createdBy);
    const u = db.session ? userById(db.session) : null;
    return {
      invite: { id: g.id, name: g.name, emoji: g.emoji, memberCount: db.members.filter((m) => m.groupId === g.id).length, inviter: publicUser(inviter) },
      isMember: u ? isMember(u.id, g.id) : false,
    };
  }),
  acceptInvite: op((code) => {
    const uid = current().id;
    const g = groups.byCode(code);
    groups.addMember(g.id, uid);
    return { group: groups.get(uid, g.id) };
  }),

  slots: op((params = {}) => slotOverview(current().id, params)),
  setSlot: op((date, part, free) => slotService.set(current().id, { date, part, free })),
  round: op((groupId, date, part) => ({ round: getRound(current().id, groupId, date, part) })),
  roundMessage: op((groupId, date, part, body) => ({ round: slotService.postMessage(current().id, groupId, date, part, body) })),

  notifications: op(() => {
    const uid = current().id;
    const list = db.notifications
      .filter((n) => n.userId === uid)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50)
      .map((n) => {
        const p = db.posts.find((x) => x.id === n.postId);
        return {
          id: n.id, type: n.type, postId: n.postId,
          post: p ? { title: p.title, emoji: p.emoji, type: p.type } : null,
          actor: publicUser(userById(n.actorId)), data: n.data, createdAt: n.createdAt, read: Boolean(n.readAt),
        };
      });
    return { notifications: list, unread: list.filter((n) => !n.read).length };
  }),
  readNotifications: op(() => {
    const uid = current().id;
    db.notifications.forEach((n) => n.userId === uid && !n.readAt && (n.readAt = nowIso()));
  }),

  /** Demo only: wipe local data and start over with fresh demo friends. */
  resetDemo: op(async () => {
    await seed();
  }),
};
