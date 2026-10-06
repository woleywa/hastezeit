// German display formatting shared by the app UI, server-rendered share pages and share texts.
import { dateParts, diffDays } from './time.js';

export const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export const WEEKDAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONTHS = ['Jan', 'Feb', 'März', 'Apr', 'Mai', 'Juni', 'Juli', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/** "Heute", "Morgen", "Freitag" or "Fr, 17. Okt" – relative to `now`. */
export function dayLabel(iso, { now = new Date(), tz } = {}) {
  const p = dateParts(iso, tz);
  const today = dateParts(now, tz).date;
  const diff = diffDays(today, p.date);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  if (diff === -1) return 'Gestern';
  if (diff > 1 && diff < 7) return WEEKDAYS[p.weekday];
  const [, m, d] = p.date.split('-').map(Number);
  return `${WEEKDAYS_SHORT[p.weekday]}, ${d}. ${MONTHS[m - 1]}`;
}

export function timeLabel(iso, tz) {
  return dateParts(iso, tz).time;
}

/** "18:00–20:00" or "20:00" */
export function timeRange(startIso, endIso, tz) {
  const s = timeLabel(startIso, tz);
  if (!endIso) return s;
  return `${s}–${timeLabel(endIso, tz)}`;
}

/** "Dienstag · 18:00–20:00" */
export function whenLabel(startIso, endIso, opts = {}) {
  return `${dayLabel(startIso, opts)} · ${timeRange(startIso, endIso, opts.tz)}`;
}

/** Spoken style for share texts: "Freitag 20 Uhr", "Heute 18:30–20 Uhr" */
export function spokenWhen(startIso, endIso, opts = {}) {
  const uhr = (iso) => {
    const [h, m] = timeLabel(iso, opts.tz).split(':');
    return m === '00' ? String(Number(h)) : `${Number(h)}:${m}`;
  };
  const time = endIso ? `${uhr(startIso)}–${uhr(endIso)} Uhr` : `${uhr(startIso)} Uhr`;
  return `${dayLabel(startIso, opts)} ${time}`;
}

export function firstName(name = '') {
  return String(name).trim().split(/\s+/)[0] || name;
}

/** "Anna", "Anna & Max", "Anna, Max & 2 weitere" */
export function joinNames(names, max = 2) {
  const n = names.map(firstName);
  if (n.length === 0) return '';
  if (n.length === 1) return n[0];
  if (n.length <= max) return `${n.slice(0, -1).join(', ')} & ${n[n.length - 1]}`;
  return `${n.slice(0, max).join(', ')} & ${n.length - max} weitere`;
}
