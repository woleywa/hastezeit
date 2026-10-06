// SQLite via Node's built-in `node:sqlite` – no native npm dependency, a single file on disk.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Append-only list of migrations. PRAGMA user_version tracks how many have been applied.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT UNIQUE COLLATE NOCASE,
    phone         TEXT UNIQUE,              -- E.164, for the WhatsApp channel later
    password_hash TEXT,
    emoji         TEXT,
    color         TEXT,
    is_demo       INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE friend_groups (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    emoji       TEXT,
    invite_code TEXT NOT NULL UNIQUE,
    created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE group_members (
    group_id  TEXT NOT NULL REFERENCES friend_groups(id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    joined_at TEXT NOT NULL,
    PRIMARY KEY (group_id, user_id)
  );
  CREATE INDEX group_members_user ON group_members(user_id);

  CREATE TABLE posts (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL CHECK (type IN ('availability', 'activity', 'help_request', 'help_offer')),
    author_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT,
    emoji        TEXT,
    starts_at    TEXT NOT NULL,             -- UTC ISO-8601
    ends_at      TEXT,                      -- UTC ISO-8601, optional
    until_at     TEXT NOT NULL,             -- ends_at or starts_at + 3h; used to hide past posts
    location     TEXT,
    capacity     INTEGER,                   -- max participants (activity) / people needed or offered (help)
    ideas        TEXT,                      -- JSON array of activity ideas (availability)
    share_code   TEXT NOT NULL UNIQUE,
    source       TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'nlp', 'whatsapp')),
    raw_input    TEXT,                      -- original free text if created via parser / bot
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    cancelled_at TEXT
  );
  CREATE INDEX posts_starts_at ON posts(starts_at);
  CREATE INDEX posts_author ON posts(author_id);

  CREATE TABLE post_groups (
    post_id  TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL REFERENCES friend_groups(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, group_id)
  );
  CREATE INDEX post_groups_group ON post_groups(group_id);

  CREATE TABLE participants (
    post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status     TEXT NOT NULL CHECK (status IN ('going', 'maybe', 'declined', 'free', 'helping', 'accepting')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (post_id, user_id)
  );
  CREATE INDEX participants_user ON participants(user_id);

  CREATE TABLE comments (
    id         TEXT PRIMARY KEY,
    post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'suggestion')),
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX comments_post ON comments(post_id, created_at);

  CREATE TABLE notifications (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    post_id    TEXT REFERENCES posts(id) ON DELETE CASCADE,
    actor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
    data       TEXT,                        -- JSON payload for the renderer / push channels
    dedupe_key TEXT UNIQUE,                 -- e.g. reminder:<post>:<user>
    created_at TEXT NOT NULL,
    read_at    TEXT
  );
  CREATE INDEX notifications_user ON notifications(user_id, created_at);
  `,
  `
  -- "Wann hast du Zeit?": one row per person, day and day part. Overlaps form automatic rounds.
  CREATE TABLE availability_slots (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,               -- calendar date in APP_TZ, YYYY-MM-DD
    part       TEXT NOT NULL CHECK (part IN ('morning', 'afternoon', 'evening')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, date, part)
  );
  CREATE INDEX availability_slots_date ON availability_slots(date, part);

  -- Chat of an automatic round (rounds themselves are derived, not stored)
  CREATE TABLE round_messages (
    id         TEXT PRIMARY KEY,
    group_id   TEXT NOT NULL REFERENCES friend_groups(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    part       TEXT NOT NULL,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX round_messages_round ON round_messages(group_id, date, part, created_at);
  `,
];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  migrate(db);
  return db;
}

function migrate(db) {
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  for (let i = version; i < MIGRATIONS.length; i++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
}

export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Builds "?, ?, ?" for IN clauses. */
export const placeholders = (arr) => arr.map(() => '?').join(', ');
