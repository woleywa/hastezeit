// Time-zone helpers without dependencies. Dates on the wire are always UTC ISO strings;
// calendar logic ("Dienstag", "heute") happens in a named time zone or in the browser's local zone.

const pad = (n) => String(n).padStart(2, '0');

// Offset (ms) between the wall clock in `tz` and UTC at instant `date`.
function tzOffsetMs(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+v.year, +v.month - 1, +v.day, +v.hour, +v.minute, +v.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** "2026-10-06" + "18:00" in tz (or local zone if tz is falsy) -> Date */
export function zonedToDate(dateStr, timeStr = '00:00', tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  if (!tz) return new Date(y, m - 1, d, hh, mm);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = tzOffsetMs(new Date(guess), tz);
  let utc = guess - offset;
  const offset2 = tzOffsetMs(new Date(utc), tz);
  if (offset2 !== offset) utc = guess - offset2;
  return new Date(utc);
}

/** Date -> { date: 'YYYY-MM-DD', time: 'HH:MM', weekday: 0..6 (So=0) } in tz (or local zone) */
export function dateParts(date, tz) {
  const d = date instanceof Date ? date : new Date(date);
  if (!tz) {
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      weekday: d.getDay(),
    };
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(d);
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(v.weekday);
  return { date: `${v.year}-${v.month}-${v.day}`, time: `${v.hour}:${v.minute}`, weekday };
}

/** Calendar arithmetic on 'YYYY-MM-DD' strings (zone-free). */
export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function diffDays(fromDateStr, toDateStr) {
  const a = Date.parse(`${fromDateStr}T00:00:00Z`);
  const b = Date.parse(`${toDateStr}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/** Monday of the week containing dateStr. */
export function startOfWeek(dateStr) {
  const wd = weekdayOf(dateStr);
  return addDays(dateStr, wd === 0 ? -6 : 1 - wd);
}

export function normalizeTime(h, m = 0) {
  const hh = Number(h);
  const mm = Number(m);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 24 || mm < 0 || mm > 59) return null;
  return `${pad(hh === 24 ? 0 : hh)}:${pad(mm)}`;
}
