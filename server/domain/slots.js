// "Wann hast du Zeit?" – availability slots and the automatic rounds they form.
import { DAYPART_IDS, DAYPARTS, SLOT_DAYS_AHEAD, LIMITS } from '../../shared/constants.js';
import { computeRounds } from '../../shared/rounds.js';
import { dateParts, addDays } from '../../shared/time.js';
import { randomId, nowIso, cleanString, badRequest, forbidden, notFound } from '../util.js';
import { placeholders } from '../db.js';
import { publicUser } from './users.js';

export function createSlotService({ db, groups, notifications, tz }) {
  const today = () => dateParts(new Date(), tz).date;

  function validate(date, part) {
    if (!DAYPART_IDS.includes(part)) throw badRequest('Unbekannte Tageszeit.');
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('Ungültiges Datum.');
    if (date < today() || date > addDays(today(), SLOT_DAYS_AHEAD)) throw badRequest('Bitte einen Tag in den nächsten 4 Wochen wählen.');
  }

  /** The viewer's groups with member ids, plus everyone's slots in [from, to]. */
  function load(userId, from, to) {
    const myGroups = groups.listForUser(userId).map((g) => ({ ...g, memberIds: g.members.map((m) => m.id) }));
    const people = [...new Set(myGroups.flatMap((g) => g.memberIds).concat(userId))];
    const slots = db
      .prepare(
        `SELECT user_id AS userId, date, part FROM availability_slots
         WHERE date >= ? AND date <= ? AND user_id IN (${placeholders(people)})`,
      )
      .all(from, to, ...people);
    const users = new Map(myGroups.flatMap((g) => g.members).map((u) => [u.id, u]));
    return { myGroups, slots, users };
  }

  function messageCounts(keys) {
    const counts = new Map();
    for (const r of db.prepare('SELECT group_id, date, part, COUNT(*) AS n FROM round_messages WHERE date >= ? GROUP BY group_id, date, part').all(today())) {
      counts.set(`${r.group_id}~${r.date}~${r.part}`, r.n);
    }
    return keys.map((k) => counts.get(k) ?? 0);
  }

  function overview(userId, { from, days = 14 } = {}) {
    const start = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : today();
    const end = addDays(start, Math.min(Math.max(Number(days) || 14, 1), 28) - 1);
    const { myGroups, slots, users } = load(userId, start, end);
    const { rounds, cells } = computeRounds({ slots, groups: myGroups, viewerId: userId });
    const counts = messageCounts(rounds.map((r) => r.key));
    return {
      from: start,
      to: end,
      today: today(),
      mySlots: slots.filter((s) => s.userId === userId).map(({ date, part }) => ({ date, part })),
      cells: Object.fromEntries(
        Object.entries(cells).map(([k, c]) => [k, { mine: c.mine, friends: c.friendIds.map((id) => users.get(id)).filter(Boolean) }]),
      ),
      rounds: rounds.map((r, i) => ({ ...r, members: r.memberIds.map((id) => users.get(id)), messageCount: counts[i] })),
    };
  }

  const service = {
    overview,

    set(userId, { date, part, free }) {
      validate(date, part);
      if (free) {
        const { changes } = db
          .prepare('INSERT OR IGNORE INTO availability_slots (user_id, date, part, created_at) VALUES (?, ?, ?, ?)')
          .run(userId, date, part, nowIso());
        if (changes) {
          // Tell everyone in my groups who is already free then: a round just formed or grew.
          const { rounds } = overview(userId, { from: date, days: 1 });
          for (const r of rounds.filter((x) => x.part === part && x.includesMe)) {
            notifications.notify({
              userIds: r.memberIds,
              type: 'match',
              actorId: userId,
              data: { groupId: r.group.id, groupName: r.group.name, date, part, count: r.memberIds.length },
              dedupeKey: (uid) => `match:${r.group.id}:${date}:${part}:${userId}:${uid}`,
            });
          }
        }
      } else {
        db.prepare('DELETE FROM availability_slots WHERE user_id = ? AND date = ? AND part = ?').run(userId, date, part);
      }
      return overview(userId);
    },

    round(userId, groupId, date, part) {
      if (!DAYPART_IDS.includes(part)) throw notFound('Diese Runde gibt es nicht.');
      const group = groups.get(userId, groupId); // throws if not a member
      const freeIds = new Set(
        db.prepare('SELECT user_id FROM availability_slots WHERE date = ? AND part = ?').all(date, part).map((r) => r.user_id),
      );
      const members = group.members.filter((m) => freeIds.has(m.id));
      const others = group.members.filter((m) => !freeIds.has(m.id));
      const messages = db
        .prepare(
          `SELECT m.*, u.id AS u_id, u.name, u.emoji, u.color FROM round_messages m JOIN users u ON u.id = m.user_id
           WHERE m.group_id = ? AND m.date = ? AND m.part = ? ORDER BY m.created_at`,
        )
        .all(groupId, date, part)
        .map((m) => ({ id: m.id, body: m.body, createdAt: m.created_at, user: publicUser({ id: m.u_id, name: m.name, emoji: m.emoji, color: m.color }), isMine: m.user_id === userId }));
      return {
        group: { id: group.id, name: group.name, emoji: group.emoji },
        date,
        part,
        daypart: DAYPARTS.find((d) => d.id === part),
        members,
        others,
        includesMe: freeIds.has(userId),
        messages,
      };
    },

    postMessage(userId, groupId, date, part, body) {
      const round = service.round(userId, groupId, date, part);
      const text = cleanString(body, LIMITS.comment, { required: true, field: 'Nachricht' });
      if (!round.includesMe) throw forbidden('Trag dich erst für diese Zeit ein, dann kannst du mitschreiben.');
      db.prepare('INSERT INTO round_messages (id, group_id, date, part, user_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        randomId(), groupId, date, part, userId, text, nowIso(),
      );
      notifications.notify({
        userIds: round.members.map((m) => m.id),
        type: 'round_message',
        actorId: userId,
        data: { groupId, groupName: round.group.name, date, part, preview: text.slice(0, 80) },
      });
      return service.round(userId, groupId, date, part);
    },
  };
  return service;
}
