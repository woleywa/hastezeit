// Notification layer.
//
// Domain code calls `notify()` with *what happened*. The service stores one row per recipient
// (that row IS the in-app notification) and hands it to every registered delivery channel.
// Today only the in-app channel exists (the client polls /api/notifications). Web Push, native push
// (APNs/FCM via Capacitor) or WhatsApp templates can be added as further channels without touching
// domain code – see channels.js.
import { randomId, nowIso, jsonParse } from '../util.js';
import { publicUser } from '../domain/users.js';
import { inAppChannel } from './channels.js';

export function createNotificationService({ db, channels = [inAppChannel] }) {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO notifications (id, user_id, type, post_id, actor_id, data, dedupe_key, created_at)
     VALUES (:id, :user_id, :type, :post_id, :actor_id, :data, :dedupe_key, :created_at)`,
  );

  return {
    /**
     * @param {{ userIds: string[], type: string, postId?: string, actorId?: string, data?: object, dedupeKey?: (userId) => string }} event
     */
    notify({ userIds, type, postId = null, actorId = null, data = {}, dedupeKey }) {
      const recipients = [...new Set(userIds)].filter((id) => id && id !== actorId);
      const created = [];
      for (const userId of recipients) {
        const row = {
          id: randomId(),
          user_id: userId,
          type,
          post_id: postId,
          actor_id: actorId,
          data: JSON.stringify(data),
          dedupe_key: dedupeKey ? dedupeKey(userId) : null,
          created_at: nowIso(),
        };
        const { changes } = insert.run(row);
        if (changes) created.push(row);
      }
      for (const channel of channels) {
        for (const n of created) {
          Promise.resolve()
            .then(() => channel.deliver(n))
            .catch((err) => console.error(`[notify:${channel.name}]`, err.message));
        }
      }
      return created.length;
    },

    list(userId, limit = 50) {
      const rows = db
        .prepare(
          `SELECT n.*, a.id AS a_id, a.name AS a_name, a.emoji AS a_emoji, a.color AS a_color,
                  p.title AS p_title, p.emoji AS p_emoji, p.type AS p_type
           FROM notifications n
           LEFT JOIN users a ON a.id = n.actor_id
           LEFT JOIN posts p ON p.id = n.post_id
           WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT ?`,
        )
        .all(userId, limit);
      return rows.map((r) => ({
        id: r.id,
        type: r.type,
        postId: r.post_id,
        post: r.post_id ? { title: r.p_title, emoji: r.p_emoji, type: r.p_type } : null,
        actor: r.a_id ? publicUser({ id: r.a_id, name: r.a_name, emoji: r.a_emoji, color: r.a_color }) : null,
        data: jsonParse(r.data, {}),
        createdAt: r.created_at,
        read: Boolean(r.read_at),
      }));
    },

    unreadCount(userId) {
      return db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).n;
    },

    markAllRead(userId) {
      db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(nowIso(), userId);
    },
  };
}
