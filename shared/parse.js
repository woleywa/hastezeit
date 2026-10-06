// Rule-based German quick-input parser.
//
//   "Dienstag 18-20 Uhr Tennis Tempelhof"
//     -> { type: 'activity', title: 'Tennis', date: '2026-10-06', start: '18:00', end: '20:00', location: 'Tempelhof' }
//
// It is deliberately a pure function (text + "today" in, draft out) so it can run in the browser,
// on the server (WhatsApp bot) and later be swapped for / combined with an LLM-based interpreter
// that returns the same shape.
import { addDays, weekdayOf, normalizeTime } from './time.js';
import { guessEmoji } from './emoji.js';
import { TYPE_META } from './constants.js';

const WEEKDAY_NAMES = {
  sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6,
  so: 0, mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6,
};

const DAYPART_TIMES = [
  [/\b(heute\s+)?abends?\b/i, '19:00'],
  [/\bnachmittags?\b/i, '15:00'],
  [/\bmittags?\b/i, '12:00'],
  [/\b(vormittags?|morgens|früh)\b/i, '10:00'],
];

const B = '(?<![\\p{L}\\d])'; // unicode-aware word boundary (start)
const E = '(?![\\p{L}\\d])'; // unicode-aware word boundary (end)
const re = (src, flags = 'iu') => new RegExp(src, flags);

function nextWeekday(today, wd) {
  const diff = (wd - weekdayOf(today) + 7) % 7;
  return addDays(today, diff);
}

function cut(state, match) {
  state.text = state.text.slice(0, match.index) + ' ' + state.text.slice(match.index + match[0].length);
}

function parseType(state) {
  const avail = re(`${B}(ich\\s+)?(hab(e)?\\s+(heute\\s+)?zeit|bin\\s+frei|noch\\s+nichts\\s+vor)${E}`).exec(state.text);
  if (avail) {
    cut(state, avail);
    return 'availability';
  }
  if (re(`${B}(biete|kann\\s+(jemandem\\s+|euch\\s+)?helfen|helfe\\s+gern)${E}`).test(state.text)) return 'help_offer';
  if (re(`${B}(brauche|suche)\\s+(hilfe|jemand|leute|helfer)|${B}hilfe${E}|${B}wer\\s+(kann|hilft)`).test(state.text)) {
    return 'help_request';
  }
  return null;
}

function parseDate(state, today) {
  // Explicit date: 12.10. / 12.10.2026 / 12.10.26
  const explicit = re(`${B}(?:am\\s+)?(\\d{1,2})\\.(\\d{1,2})\\.(\\d{2,4})?`).exec(state.text);
  if (explicit) {
    const [, d, m, y] = explicit;
    let year = y ? Number(y.length === 2 ? `20${y}` : y) : Number(today.slice(0, 4));
    const pad = (n) => String(n).padStart(2, '0');
    let date = `${year}-${pad(m)}-${pad(d)}`;
    if (!y && date < today) date = `${year + 1}-${pad(m)}-${pad(d)}`;
    if (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      cut(state, explicit);
      return date;
    }
  }

  const rel = re(`${B}(heute|übermorgen|morgen)${E}`).exec(state.text);
  if (rel) {
    cut(state, rel);
    const word = rel[1].toLowerCase();
    return addDays(today, word === 'heute' ? 0 : word === 'morgen' ? 1 : 2);
  }

  const weekend = re(`${B}(?:am\\s+|dieses\\s+|nächstes\\s+)?wochenende${E}`).exec(state.text);
  if (weekend) {
    cut(state, weekend);
    return nextWeekday(today, 6);
  }

  // Full weekday names anywhere, short forms only when followed by a time ("Di 18") or at the start.
  const long = re(`${B}(?:(?:am|diesen|nächsten|kommenden)\\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)s?${E}`).exec(state.text);
  const short = re(`(?:^\\s*|${B}(?:am\\s+))(mo|di|mi|do|fr|sa|so)\\.?(?=\\s*\\d|\\s|$)`).exec(state.text) ??
    re(`${B}(mo|di|mi|do|fr|sa|so)\\.?(?=\\s*\\d)`).exec(state.text);
  const wd = long ?? short;
  if (wd) {
    cut(state, wd);
    return nextWeekday(today, WEEKDAY_NAMES[wd[1].toLowerCase()]);
  }
  return null;
}

function parseTime(state) {
  const range = re(
    `${B}(?:von\\s+)?(\\d{1,2})(?:[:.](\\d{2}))?\\s*(?:uhr|h)?\\s*(?:-|–|bis)\\s*(\\d{1,2})(?:[:.](\\d{2}))?\\s*(?:uhr|h)?${E}`,
  ).exec(state.text);
  if (range) {
    const start = normalizeTime(range[1], range[2] ?? 0);
    const end = normalizeTime(range[3], range[4] ?? 0);
    if (start && end) {
      cut(state, range);
      return { start, end };
    }
  }

  const single = re(`${B}(?:(um|ab|gegen)\\s+)?(\\d{1,2})(?:[:.](\\d{2}))?\\s*(uhr|h)?${E}`, 'giu');
  for (const m of state.text.matchAll(single)) {
    const [, prefix, h, min, suffix] = m;
    if (!prefix && !min && !suffix) continue;
    const start = normalizeTime(h, min ?? 0);
    if (!start) continue;
    cut(state, m);
    return { start, end: null };
  }

  for (const [pattern, time] of DAYPART_TIMES) {
    const m = pattern.exec(state.text);
    if (m) {
      cut(state, m);
      return { start: time, end: null };
    }
  }
  return { start: null, end: null };
}

function parseLocation(state, type) {
  const markers = type === 'help_request' || type === 'help_offer'
    ? '(?:in\\s+der|im|in|@)'
    : '(?:in\\s+der|im|in|am|an\\s+der|auf\\s+dem|auf\\s+der|beim|@)';
  const m = re(`(?:^|\\s)${markers}\\s+(.+)$`).exec(state.text);
  if (m && /\p{Lu}|\d/u.test(m[1].trim()[0] ?? '')) {
    cut(state, m);
    return m[1].trim();
  }
  if (m && m[0].trim().startsWith('@')) {
    cut(state, m);
    return m[1].trim();
  }

  // "Tennis Tempelhof": known activity word followed by a capitalised place name.
  const words = state.text.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2 && guessEmoji(words[0]) !== TYPE_META.activity.emoji && /^\p{Lu}/u.test(words[1])) {
    state.text = words[0];
    return words.slice(1).join(' ');
  }
  return null;
}

function cleanTitle(text) {
  const t = text
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:·\-–]+|[\s,;:·\-–]+$/g, '')
    .trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

/**
 * @param {string} input free text
 * @param {{ today: string }} ctx today's calendar date (YYYY-MM-DD) in the user's zone
 */
export function parseQuickInput(input, { today }) {
  const state = { text: ` ${String(input ?? '').trim()} ` };
  const typeHint = parseType(state);
  const date = parseDate(state, today);
  const { start, end } = parseTime(state);
  const location = parseLocation(state, typeHint);
  const title = cleanTitle(state.text);
  const type = typeHint ?? (title ? 'activity' : date || start ? 'availability' : null);

  return {
    type,
    title,
    date,
    start,
    end,
    location,
    emoji: guessEmoji(`${title} ${input}`, type ?? 'activity'),
    recognized: Boolean(date || start || location || typeHint),
  };
}
