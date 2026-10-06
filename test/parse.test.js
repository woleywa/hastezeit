import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickInput } from '../shared/parse.js';
import { interpret } from '../server/domain/interpret.js';
import { zonedToDate, dateParts } from '../shared/time.js';

const today = '2026-10-03'; // a Saturday
const parse = (t) => parseQuickInput(t, { today });

test('activity with weekday, range and location', () => {
  assert.deepEqual(
    { ...parse('Dienstag 18-20 Uhr Tennis Tempelhof'), emoji: undefined, recognized: undefined },
    { type: 'activity', title: 'Tennis', date: '2026-10-06', start: '18:00', end: '20:00', location: 'Tempelhof', emoji: undefined, recognized: undefined },
  );
});

test('single time keeps multi-word title', () => {
  const p = parse('Freitag 20 Uhr Expertise Bar');
  assert.equal(p.title, 'Expertise Bar');
  assert.equal(p.date, '2026-10-09');
  assert.equal(p.start, '20:00');
  assert.equal(p.end, null);
  assert.equal(p.emoji, '🍺');
});

test('availability phrase', () => {
  const p = parse('Ich habe Zeit morgen 19-22');
  assert.equal(p.type, 'availability');
  assert.equal(p.date, '2026-10-04');
  assert.deepEqual([p.start, p.end], ['19:00', '22:00']);
});

test('help request and offer hints', () => {
  assert.equal(parse('Sa 14 Uhr Hilfe beim Couchtragen').type, 'help_request');
  assert.equal(parse('biete Sonntag Auto für Transport').type, 'help_offer');
});

test('relative days, dayparts, explicit dates, @ location', () => {
  const p = parse('heute abend Bier im Prater');
  assert.deepEqual([p.date, p.start, p.title, p.location], ['2026-10-03', '19:00', 'Bier', 'Prater']);
  assert.equal(parse('12.10. 19 Uhr Kino').date, '2026-10-12');
  assert.equal(parse('2.1. Kino').date, '2027-01-02'); // past date → next year
  assert.equal(parse('Mi Kaffee @ Bonanza').location, 'Bonanza');
});

test('short weekday abbreviations do not eat normal words', () => {
  const p = parse('Wer kommt mit ins Kino so gegen acht');
  assert.equal(p.date, null);
});

test('interpret() converts to UTC in the app time zone', () => {
  const now = zonedToDate('2026-10-03', '12:00', 'Europe/Berlin');
  const d = interpret('Dienstag 18-20 Tennis', { now, tz: 'Europe/Berlin' });
  assert.equal(d.startsAt, '2026-10-06T16:00:00.000Z'); // CEST = UTC+2
  assert.equal(d.endsAt, '2026-10-06T18:00:00.000Z');
  assert.equal(d.complete, true);
  assert.equal(interpret('irgendwas', { now }).complete, false);
});

test('zone helpers survive the DST switch', () => {
  const winter = zonedToDate('2026-11-03', '18:00', 'Europe/Berlin');
  assert.equal(winter.toISOString(), '2026-11-03T17:00:00.000Z');
  assert.equal(dateParts(winter, 'Europe/Berlin').time, '18:00');
});
