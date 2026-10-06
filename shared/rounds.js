// Automatic rounds ("Runden"): everyone in the same friend group who marked the same day part
// forms a round. Pure functions – used by the server and by the in-browser web demo.
import { DAYPARTS } from './constants.js';

export const roundKey = (groupId, date, part) => `${groupId}~${date}~${part}`;

/**
 * @param {{ userId: string, date: string, part: string }[]} slots   slots of everyone in the viewer's groups
 * @param {{ id: string, name: string, emoji: string, memberIds: string[] }[]} groups  the viewer's groups
 * @param {string} viewerId
 * @returns {{ rounds: object[], cells: Record<string, { mine: boolean, friendIds: string[] }> }}
 *   rounds – every group/time where ≥ 2 members are free (sorted by date, part)
 *   cells  – per "date~part": whether the viewer is free and which friends (from any shared group) are
 */
export function computeRounds({ slots, groups, viewerId }) {
  const freeAt = new Map(); // "date~part" → Set(userId)
  for (const s of slots) {
    const k = `${s.date}~${s.part}`;
    if (!freeAt.has(k)) freeAt.set(k, new Set());
    freeAt.get(k).add(s.userId);
  }
  const friends = new Set(groups.flatMap((g) => g.memberIds));
  friends.delete(viewerId);

  const cells = {};
  const rounds = [];
  for (const [k, users] of freeAt) {
    const [date, part] = k.split('~');
    cells[k] = { mine: users.has(viewerId), friendIds: [...users].filter((u) => friends.has(u)) };
    for (const g of groups) {
      const memberIds = g.memberIds.filter((m) => users.has(m));
      if (memberIds.length < 2) continue;
      rounds.push({
        key: roundKey(g.id, date, part),
        group: { id: g.id, name: g.name, emoji: g.emoji },
        date,
        part,
        memberIds,
        includesMe: memberIds.includes(viewerId),
      });
    }
  }
  const partIndex = (p) => DAYPARTS.findIndex((d) => d.id === p);
  rounds.sort((a, b) => a.date.localeCompare(b.date) || partIndex(a.part) - partIndex(b.part) || b.memberIds.length - a.memberIds.length);
  // Friend groups overlap (Tennis ⊂ Berlin Crew). Keep one round per set of people:
  // drop a round whose members all sit in a bigger (or equal, earlier) round at the same time.
  const kept = rounds.filter(
    (r, i) =>
      !rounds.some(
        (o, j) => j !== i && o.date === r.date && o.part === r.part && (j < i || o.memberIds.length > r.memberIds.length) &&
          o.memberIds.length >= r.memberIds.length && r.memberIds.every((m) => o.memberIds.includes(m)),
      ),
  );
  return { rounds: kept, cells };
}

/** Picks a random idea and a random organiser – the "🎲 Würfeln" button in a round. */
export function rollDice(ideas, people, random = Math.random) {
  const idea = ideas[Math.floor(random() * ideas.length)];
  const host = people[Math.floor(random() * people.length)];
  return { idea, host };
}
