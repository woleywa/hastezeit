// Posts, participation and comments – the core domain of the app. No HTTP in here.
import {
  POST_TYPES,
  PARTICIPATION_BY_TYPE,
  POSITIVE_STATUS,
  COMMENT_KINDS,
  POST_SOURCES,
  LIMITS,
} from '../../shared/constants.js';
import { guessEmoji } from '../../shared/emoji.js';
import { firstName } from '../../shared/format.js';
import { randomId, nowIso, cleanString, parseIso, jsonParse, badRequest, forbidden, notFound, conflict } from '../util.js';
import { placeholders, transaction } from '../db.js';
import { publicUser } from './users.js';

const HOUR = 3600_000;
const DEFAULT_DURATION = 3 * HOUR;
const DEFAULT_AVAILABILITY_TITLE = 'Hab Zeit';

export function createPostService({ db, groups, notifications }) {
  const getRow = (id) => db.prepare('SELECT * FROM posts WHERE id = ?').get(id);

  function canView(userId, post) {
    if (post.author_id === userId) return true;
    const viaGroup = db
      .prepare(
        `SELECT 1 FROM post_groups pg JOIN group_members gm ON gm.group_id = pg.group_id
         WHERE pg.post_id = ? AND gm.user_id = ? LIMIT 1`,
      )
      .get(post.id, userId);
    if (viaGroup) return true;
    return Boolean(db.prepare('SELECT 1 FROM participants WHERE post_id = ? AND user_id = ?').get(post.id, userId));
  }

  function requireVisible(userId, id) {
    const post = getRow(id);
    if (!post || post.cancelled_at) throw notFound('Diesen Eintrag gibt es nicht (mehr).');
    if (!canView(userId, post)) throw forbidden('Dieser Eintrag ist nur für die Gruppe sichtbar.');
    return post;
  }

  /** Batch-loads authors, groups, participants and comment counts for a list of post rows. */
  function serialize(rows, viewerId) {
    if (!rows.length) return [];
    const ids = rows.map((p) => p.id);
    const authorIds = [...new Set(rows.map((p) => p.author_id))];
    const authors = new Map(
      db
        .prepare(`SELECT * FROM users WHERE id IN (${placeholders(authorIds)})`)
        .all(...authorIds)
        .map((u) => [u.id, publicUser(u)]),
    );

    const groupRows = db
      .prepare(
        `SELECT pg.post_id, g.id, g.name, g.emoji FROM post_groups pg JOIN friend_groups g ON g.id = pg.group_id
         WHERE pg.post_id IN (${placeholders(ids)})`,
      )
      .all(...ids);
    const partRows = db
      .prepare(
        `SELECT pa.post_id, pa.status, pa.updated_at, u.* FROM participants pa JOIN users u ON u.id = pa.user_id
         WHERE pa.post_id IN (${placeholders(ids)}) ORDER BY pa.updated_at`,
      )
      .all(...ids);
    const commentCounts = new Map(
      db
        .prepare(
          `SELECT post_id, COUNT(*) AS n FROM comments WHERE post_id IN (${placeholders(ids)}) GROUP BY post_id`,
        )
        .all(...ids)
        .map((r) => [r.post_id, r.n]),
    );

    return rows.map((p) => {
      const participants = partRows
        .filter((r) => r.post_id === p.id)
        .map((r) => ({ user: publicUser(r), status: r.status }));
      const counts = {};
      for (const { status } of participants) counts[status] = (counts[status] ?? 0) + 1;
      const mine = participants.find((x) => x.user.id === viewerId);
      return {
        id: p.id,
        type: p.type,
        title: p.title,
        description: p.description,
        emoji: p.emoji,
        startsAt: p.starts_at,
        endsAt: p.ends_at,
        location: p.location,
        capacity: p.capacity,
        ideas: jsonParse(p.ideas, []),
        shareCode: p.share_code,
        source: p.source,
        author: authors.get(p.author_id),
        groups: groupRows.filter((g) => g.post_id === p.id).map(({ id, name, emoji }) => ({ id, name, emoji })),
        participants,
        counts,
        positiveCount: counts[POSITIVE_STATUS[p.type]] ?? 0,
        myStatus: mine?.status ?? null,
        isMine: p.author_id === viewerId,
        commentCount: commentCounts.get(p.id) ?? 0,
        createdAt: p.created_at,
      };
    });
  }

  function validateInput(userId, input) {
    const type = input.type;
    if (!POST_TYPES.includes(type)) throw badRequest('Unbekannter Typ.');

    let title = cleanString(input.title, LIMITS.title, { field: 'Titel' });
    if (!title) {
      if (type === 'availability') title = DEFAULT_AVAILABILITY_TITLE;
      else throw badRequest('Was habt ihr vor? Bitte einen Titel angeben.');
    }

    const startsAt = parseIso(input.startsAt, 'Startzeit');
    const endsAt = input.endsAt ? parseIso(input.endsAt, 'Endzeit') : null;
    if (endsAt && endsAt <= startsAt) throw badRequest('Das Ende muss nach dem Start liegen.');
    const start = Date.parse(startsAt);
    if (start < Date.now() - 12 * HOUR) throw badRequest('Der Termin liegt in der Vergangenheit.');
    if (start > Date.now() + 366 * 24 * HOUR) throw badRequest('Bitte einen Termin innerhalb eines Jahres wählen.');

    let capacity = input.capacity ?? null;
    if (capacity !== null && capacity !== '') {
      capacity = Number(capacity);
      if (!Number.isInteger(capacity) || capacity < 1 || capacity > LIMITS.capacity) {
        throw badRequest('Anzahl Personen ist ungültig.');
      }
    } else capacity = null;

    let ideas = [];
    if (type === 'availability' && Array.isArray(input.ideas)) {
      ideas = input.ideas
        .slice(0, LIMITS.ideas)
        .map((i) => cleanString(i, LIMITS.idea, { field: 'Idee' }))
        .filter(Boolean);
    }

    const groupIds = Array.isArray(input.groupIds) ? [...new Set(input.groupIds)] : [];
    if (!groupIds.length) throw badRequest('Bitte mindestens eine Gruppe auswählen.');
    for (const gid of groupIds) {
      if (!groups.isMember(userId, gid)) throw forbidden('Du kannst nur in deine eigenen Gruppen posten.');
    }

    const source = POST_SOURCES.includes(input.source) ? input.source : 'app';
    const description = cleanString(input.description, LIMITS.description, { field: 'Beschreibung' });

    return {
      type,
      title,
      description,
      emoji:
        cleanString(input.emoji, 16, { field: 'Emoji' }) ??
        (type === 'availability'
          ? ideas[0]?.split(' ')[0] ?? '👋'
          : guessEmoji(`${title} ${description ?? ''}`, type)),
      starts_at: startsAt,
      ends_at: endsAt,
      until_at: endsAt ?? new Date(start + DEFAULT_DURATION).toISOString(),
      location: cleanString(input.location, LIMITS.location, { field: 'Ort' }),
      capacity,
      ideas: ideas.length ? JSON.stringify(ideas) : null,
      source,
      raw_input: cleanString(input.rawInput, 500, { field: 'Eingabe' }),
      groupIds,
    };
  }

  const service = {
    canView,

    create(userId, input) {
      const { groupIds, ...fields } = validateInput(userId, input);
      const now = nowIso();
      const post = {
        id: randomId(),
        author_id: userId,
        share_code: randomId(8),
        created_at: now,
        updated_at: now,
        ...fields,
      };
      transaction(db, () => {
        db.prepare(
          `INSERT INTO posts (id, type, author_id, title, description, emoji, starts_at, ends_at, until_at, location,
                              capacity, ideas, share_code, source, raw_input, created_at, updated_at)
           VALUES (:id, :type, :author_id, :title, :description, :emoji, :starts_at, :ends_at, :until_at, :location,
                   :capacity, :ideas, :share_code, :source, :raw_input, :created_at, :updated_at)`,
        ).run(post);
        const link = db.prepare('INSERT INTO post_groups (post_id, group_id) VALUES (?, ?)');
        for (const gid of groupIds) link.run(post.id, gid);
      });

      if (post.type !== 'availability') {
        const recipients = db
          .prepare(`SELECT DISTINCT user_id FROM group_members WHERE group_id IN (${placeholders(groupIds)})`)
          .all(...groupIds)
          .map((r) => r.user_id);
        notifications.notify({
          userIds: recipients,
          type: 'post_created',
          postId: post.id,
          actorId: userId,
          data: { postType: post.type },
        });
      }
      return service.get(userId, post.id);
    },

    /** Upcoming posts visible to the user, ordered by start time. */
    list(userId, { from, to, groupId, type } = {}) {
      const params = { uid: userId, from: from ? parseIso(from, 'from') : nowIso() };
      let sql = `
        SELECT p.* FROM posts p
        WHERE p.cancelled_at IS NULL
          AND p.until_at >= :from
          AND (p.author_id = :uid
               OR EXISTS (SELECT 1 FROM post_groups pg JOIN group_members gm ON gm.group_id = pg.group_id
                          WHERE pg.post_id = p.id AND gm.user_id = :uid)
               OR EXISTS (SELECT 1 FROM participants pa WHERE pa.post_id = p.id AND pa.user_id = :uid))`;
      if (to) {
        params.to = parseIso(to, 'to');
        sql += ' AND p.starts_at < :to';
      }
      if (groupId) {
        if (!groups.isMember(userId, groupId)) throw forbidden('Du bist nicht in dieser Gruppe.');
        params.gid = groupId;
        sql += ' AND EXISTS (SELECT 1 FROM post_groups WHERE post_id = p.id AND group_id = :gid)';
      }
      if (type) {
        const types = type === 'help' ? ['help_request', 'help_offer'] : [type];
        if (!types.every((t) => POST_TYPES.includes(t))) throw badRequest('Unbekannter Typ.');
        sql += ` AND p.type IN (${types.map((t) => `'${t}'`).join(', ')})`;
      }
      sql += ' ORDER BY p.starts_at ASC LIMIT 200';
      return serialize(db.prepare(sql).all(params), userId);
    },

    get(userId, id) {
      const row = requireVisible(userId, id);
      const [post] = serialize([row], userId);
      post.comments = db
        .prepare(
          `SELECT c.*, u.id AS u_id, u.name AS u_name, u.emoji AS u_emoji, u.color AS u_color
           FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.created_at`,
        )
        .all(id)
        .map((c) => ({
          id: c.id,
          kind: c.kind,
          body: c.body,
          createdAt: c.created_at,
          user: publicUser({ id: c.u_id, name: c.u_name, emoji: c.u_emoji, color: c.u_color }),
          isMine: c.user_id === userId,
        }));
      return post;
    },

    cancel(userId, id) {
      const post = requireVisible(userId, id);
      if (post.author_id !== userId) throw forbidden('Nur wer den Eintrag erstellt hat, kann ihn absagen.');
      db.prepare('UPDATE posts SET cancelled_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), id);
    },

    setParticipation(userId, id, status, { viaShare = false } = {}) {
      const post = viaShare ? getRow(id) : requireVisible(userId, id);
      if (!post || post.cancelled_at) throw notFound('Diesen Eintrag gibt es nicht (mehr).');
      if (post.author_id === userId) throw badRequest('Das ist dein eigener Eintrag 🙂');
      if (!PARTICIPATION_BY_TYPE[post.type].includes(status)) throw badRequest('Ungültiger Status.');

      const previous = db.prepare('SELECT status FROM participants WHERE post_id = ? AND user_id = ?').get(id, userId);
      if (previous?.status === status) return service.get(userId, id);

      if (status === POSITIVE_STATUS[post.type] && post.capacity) {
        const { n } = db
          .prepare('SELECT COUNT(*) AS n FROM participants WHERE post_id = ? AND status = ? AND user_id != ?')
          .get(id, status, userId);
        if (n >= post.capacity) {
          throw conflict(post.type === 'help_request' ? 'Es sind schon genug Helfer:innen da 🎉' : 'Leider schon voll.');
        }
      }

      const now = nowIso();
      db.prepare(
        `INSERT INTO participants (post_id, user_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (post_id, user_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
      ).run(id, userId, status, now, now);

      if (status !== 'declined') {
        notifications.notify({
          userIds: [post.author_id],
          type: 'participation',
          postId: id,
          actorId: userId,
          data: { status },
        });
      }
      return service.get(userId, id);
    },

    removeParticipation(userId, id) {
      requireVisible(userId, id);
      db.prepare('DELETE FROM participants WHERE post_id = ? AND user_id = ?').run(id, userId);
      return service.get(userId, id);
    },

    addComment(userId, id, { body, kind = 'comment' }) {
      const post = requireVisible(userId, id);
      if (!COMMENT_KINDS.includes(kind)) throw badRequest('Ungültige Art von Kommentar.');
      const comment = {
        id: randomId(),
        post_id: id,
        user_id: userId,
        kind,
        body: cleanString(body, LIMITS.comment, { required: true, field: 'Kommentar' }),
        created_at: nowIso(),
      };
      db.prepare(
        'INSERT INTO comments (id, post_id, user_id, kind, body, created_at) VALUES (:id, :post_id, :user_id, :kind, :body, :created_at)',
      ).run(comment);

      const previousCommenters = db
        .prepare('SELECT DISTINCT user_id FROM comments WHERE post_id = ?')
        .all(id)
        .map((r) => r.user_id);
      notifications.notify({
        userIds: [post.author_id, ...previousCommenters],
        type: kind === 'suggestion' ? 'suggestion' : 'comment',
        postId: id,
        actorId: userId,
        data: { preview: comment.body.slice(0, 80) },
      });
      return service.get(userId, id);
    },

    deleteComment(userId, commentId) {
      const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId);
      if (!c) throw notFound('Kommentar nicht gefunden.');
      if (c.user_id !== userId) throw forbidden('Du kannst nur eigene Kommentare löschen.');
      db.prepare('DELETE FROM comments WHERE id = ?').run(commentId);
      return service.get(userId, c.post_id);
    },

    /** Public, minimal view of a shared link (for WhatsApp previews and logged-out visitors). */
    sharePreview(code) {
      const p = db.prepare('SELECT * FROM posts WHERE share_code = ?').get(code);
      if (!p) throw notFound('Dieser Link ist ungültig.');
      const author = db.prepare('SELECT * FROM users WHERE id = ?').get(p.author_id);
      const positive = db
        .prepare(
          `SELECT u.name FROM participants pa JOIN users u ON u.id = pa.user_id
           WHERE pa.post_id = ? AND pa.status = ? ORDER BY pa.updated_at`,
        )
        .all(p.id, POSITIVE_STATUS[p.type])
        .map((r) => firstName(r.name));
      return {
        id: p.id,
        code: p.share_code,
        type: p.type,
        title: p.title,
        emoji: p.emoji,
        description: p.description,
        startsAt: p.starts_at,
        endsAt: p.ends_at,
        location: p.location,
        capacity: p.capacity,
        cancelled: Boolean(p.cancelled_at),
        author: { ...publicUser(author), name: firstName(author.name) },
        positiveNames: positive,
      };
    },

    /** Someone who received the link joins directly – the share code acts as the capability. */
    joinViaShare(userId, code) {
      const p = db.prepare('SELECT id, type, author_id FROM posts WHERE share_code = ?').get(code);
      if (!p) throw notFound('Dieser Link ist ungültig.');
      if (p.author_id === userId) return service.get(userId, p.id);
      return service.setParticipation(userId, p.id, POSITIVE_STATUS[p.type], { viaShare: true });
    },

    /** Creates reminder notifications for everything starting within `windowMs`. Idempotent. */
    runReminders(now = new Date(), windowMs = HOUR) {
      const rows = db
        .prepare(
          `SELECT * FROM posts WHERE cancelled_at IS NULL AND type != 'availability'
           AND starts_at > ? AND starts_at <= ?`,
        )
        .all(now.toISOString(), new Date(now.getTime() + windowMs).toISOString());
      let sent = 0;
      for (const p of rows) {
        const attendees = db
          .prepare('SELECT user_id FROM participants WHERE post_id = ? AND status = ?')
          .all(p.id, POSITIVE_STATUS[p.type])
          .map((r) => r.user_id);
        sent += notifications.notify({
          userIds: [p.author_id, ...attendees],
          type: 'reminder',
          postId: p.id,
          data: { startsAt: p.starts_at },
          dedupeKey: (uid) => `reminder:${p.id}:${uid}`,
        });
      }
      return sent;
    },
  };
  return service;
}
