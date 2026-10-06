import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { AVATAR_COLORS, LIMITS } from '../../shared/constants.js';
import { randomId, nowIso, badRequest, conflict, unauthorized, cleanString } from '../util.js';

const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 90;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  if (!stored?.startsWith('scrypt$')) return false;
  const [, saltB64, hashB64] = stored.split('$');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Shape exposed to other users – never includes email, phone or hashes. */
export function publicUser(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, emoji: row.emoji, color: row.color };
}

export function createUserService({ db }) {
  const byId = db.prepare('SELECT * FROM users WHERE id = ?');
  const byEmail = db.prepare('SELECT * FROM users WHERE email = ?');

  return {
    getById: (id) => byId.get(id) ?? null,
    getByPhone: (phone) => db.prepare('SELECT * FROM users WHERE phone = ?').get(phone) ?? null,

    async register({ name, email, password, emoji = null, color = null, isDemo = false, phone = null }) {
      name = cleanString(name, LIMITS.userName, { required: true, field: 'Name' });
      email = cleanString(email, 200, { required: true, field: 'E-Mail' }).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Bitte eine gültige E-Mail angeben.');
      if (typeof password !== 'string' || password.length < 6) throw badRequest('Passwort: mindestens 6 Zeichen.');
      if (byEmail.get(email)) throw conflict('Diese E-Mail ist schon registriert. Bitte einloggen.');
      const user = {
        id: randomId(),
        name,
        email,
        phone,
        password_hash: await hashPassword(password),
        emoji,
        color: color ?? AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
        is_demo: isDemo ? 1 : 0,
        created_at: nowIso(),
      };
      db.prepare(
        `INSERT INTO users (id, name, email, phone, password_hash, emoji, color, is_demo, created_at)
         VALUES (:id, :name, :email, :phone, :password_hash, :emoji, :color, :is_demo, :created_at)`,
      ).run(user);
      return user;
    },

    async authenticate(email, password) {
      const user = typeof email === 'string' ? byEmail.get(email.trim().toLowerCase()) : null;
      if (!user || typeof password !== 'string' || !(await verifyPassword(password, user.password_hash))) {
        throw unauthorized('E-Mail oder Passwort stimmt nicht.');
      }
      return user;
    },

    updateProfile(userId, { name, emoji, color }) {
      const user = byId.get(userId);
      const next = {
        id: userId,
        name: name === undefined ? user.name : cleanString(name, LIMITS.userName, { required: true, field: 'Name' }),
        emoji: emoji === undefined ? user.emoji : cleanString(emoji, 16, { field: 'Emoji' }),
        color: color === undefined ? user.color : AVATAR_COLORS.includes(color) ? color : user.color,
      };
      db.prepare('UPDATE users SET name = :name, emoji = :emoji, color = :color WHERE id = :id').run(next);
      return byId.get(userId);
    },

    createSession(userId) {
      const token = crypto.randomBytes(32).toString('base64url');
      const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
      db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
        sha256(token),
        userId,
        nowIso(),
        expires,
      );
      return { token, maxAge: SESSION_DAYS * 86400 };
    },

    userForSession(token) {
      if (!token) return null;
      const row = db
        .prepare(
          `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.expires_at > ?`,
        )
        .get(sha256(token), nowIso());
      return row ?? null;
    },

    deleteSession(token) {
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    },

    listDemoUsers() {
      return db.prepare('SELECT * FROM users WHERE is_demo = 1 ORDER BY created_at').all().map(publicUser);
    },
  };
}
