import { LIMITS } from '../../shared/constants.js';
import { randomId, nowIso, cleanString, notFound, forbidden, badRequest } from '../util.js';
import { placeholders, transaction } from '../db.js';
import { publicUser } from './users.js';

export function createGroupService({ db }) {
  const isMember = (userId, groupId) =>
    Boolean(db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId));

  function membersOf(groupIds) {
    if (!groupIds.length) return new Map();
    const rows = db
      .prepare(
        `SELECT gm.group_id, gm.role, u.* FROM group_members gm JOIN users u ON u.id = gm.user_id
         WHERE gm.group_id IN (${placeholders(groupIds)}) ORDER BY gm.joined_at`,
      )
      .all(...groupIds);
    const map = new Map(groupIds.map((id) => [id, []]));
    for (const r of rows) map.get(r.group_id).push({ ...publicUser(r), role: r.role });
    return map;
  }

  function serialize(rows) {
    const members = membersOf(rows.map((g) => g.id));
    return rows.map((g) => ({
      id: g.id,
      name: g.name,
      emoji: g.emoji,
      inviteCode: g.invite_code,
      members: members.get(g.id),
    }));
  }

  const service = {
    isMember,

    groupIdsFor(userId) {
      return db.prepare('SELECT group_id FROM group_members WHERE user_id = ?').all(userId).map((r) => r.group_id);
    },

    listForUser(userId) {
      const rows = db
        .prepare(
          `SELECT g.* FROM friend_groups g JOIN group_members gm ON gm.group_id = g.id
           WHERE gm.user_id = ? ORDER BY g.created_at`,
        )
        .all(userId);
      return serialize(rows);
    },

    get(userId, groupId) {
      const row = db.prepare('SELECT * FROM friend_groups WHERE id = ?').get(groupId);
      if (!row) throw notFound('Gruppe nicht gefunden.');
      if (!isMember(userId, groupId)) throw forbidden('Du bist nicht in dieser Gruppe.');
      return serialize([row])[0];
    },

    create(userId, { name, emoji }) {
      const group = {
        id: randomId(),
        name: cleanString(name, LIMITS.groupName, { required: true, field: 'Gruppenname' }),
        emoji: cleanString(emoji, 16, { field: 'Emoji' }) ?? '👥',
        invite_code: randomId(10),
        created_by: userId,
        created_at: nowIso(),
      };
      transaction(db, () => {
        db.prepare(
          `INSERT INTO friend_groups (id, name, emoji, invite_code, created_by, created_at)
           VALUES (:id, :name, :emoji, :invite_code, :created_by, :created_at)`,
        ).run(group);
        db.prepare("INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'admin', ?)").run(
          group.id,
          userId,
          group.created_at,
        );
      });
      return service.get(userId, group.id);
    },

    addMember(groupId, userId, role = 'member') {
      db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(
        groupId,
        userId,
        role,
        nowIso(),
      );
    },

    /** Public preview of an invite link (shown before login). */
    invitePreview(code) {
      const g = db.prepare('SELECT * FROM friend_groups WHERE invite_code = ?').get(code);
      if (!g) throw notFound('Dieser Einladungslink ist ungültig oder abgelaufen.');
      const inviter = g.created_by ? db.prepare('SELECT * FROM users WHERE id = ?').get(g.created_by) : null;
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?').get(g.id);
      return { id: g.id, name: g.name, emoji: g.emoji, memberCount: n, inviter: publicUser(inviter) };
    },

    acceptInvite(userId, code) {
      const g = db.prepare('SELECT id FROM friend_groups WHERE invite_code = ?').get(code);
      if (!g) throw notFound('Dieser Einladungslink ist ungültig oder abgelaufen.');
      service.addMember(g.id, userId);
      return service.get(userId, g.id);
    },

    rotateInvite(userId, groupId) {
      service.get(userId, groupId);
      db.prepare('UPDATE friend_groups SET invite_code = ? WHERE id = ?').run(randomId(10), groupId);
      return service.get(userId, groupId);
    },

    leave(userId, groupId) {
      if (!isMember(userId, groupId)) throw badRequest('Du bist nicht in dieser Gruppe.');
      transaction(db, () => {
        db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, userId);
        const { n } = db.prepare('SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?').get(groupId);
        if (n === 0) db.prepare('DELETE FROM friend_groups WHERE id = ?').run(groupId);
      });
    },
  };
  return service;
}
