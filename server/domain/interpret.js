// Turns free text into a post draft. This is the single seam for natural-language input:
// the app's quick input, the WhatsApp bot and any future channel go through `interpret()`.
//
// Today: deterministic rule-based parser (shared/parse.js, also runs in the browser).
// Later: plug in an LLM-based interpreter returning the same `Draft` shape and fall back to
// the rule-based one if it fails or is not configured.
import { parseQuickInput } from '../../shared/parse.js';
import { dateParts, zonedToDate, addDays } from '../../shared/time.js';

/**
 * @typedef {{ type: string, title: string, startsAt: string, endsAt: string|null, location: string|null,
 *             emoji: string, rawInput: string, complete: boolean }} Draft
 */

/** @returns {Draft} */
export function interpret(text, { now = new Date(), tz = 'Europe/Berlin' } = {}) {
  const today = dateParts(now, tz).date;
  const parsed = parseQuickInput(text, { today });
  const type = parsed.type ?? 'activity';
  const date = parsed.date ?? today;
  const start = parsed.start ?? (type === 'availability' ? '18:00' : '19:00');
  const startsAt = zonedToDate(date, start, tz);
  let endsAt = null;
  if (parsed.end) {
    // "22-1 Uhr" → ends the next day
    const endDate = parsed.end <= start ? addDays(date, 1) : date;
    endsAt = zonedToDate(endDate, parsed.end, tz).toISOString();
  }
  return {
    type,
    title: parsed.title,
    startsAt: startsAt.toISOString(),
    endsAt,
    location: parsed.location,
    emoji: parsed.emoji,
    rawInput: text,
    // Only a draft with a recognised day or time is safe to publish without asking back.
    complete: Boolean((parsed.date || parsed.start) && (parsed.title || type === 'availability')),
  };
}
