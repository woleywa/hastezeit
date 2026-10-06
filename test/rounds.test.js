import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRounds, rollDice } from '../shared/rounds.js';

const groups = [
  { id: 'crew', name: 'Crew', memberIds: ['me', 'anna', 'max', 'lisa'] },
  { id: 'tennis', name: 'Tennis', memberIds: ['me', 'anna', 'max'] },
  { id: 'uni', name: 'Uni', memberIds: ['me', 'can'] },
];
const slot = (userId, date, part = 'evening') => ({ userId, date, part });

test('people free at the same time in the same group form a round', () => {
  const { rounds, cells } = computeRounds({
    viewerId: 'me',
    groups,
    slots: [slot('me', 'd1'), slot('anna', 'd1'), slot('can', 'd2'), slot('me', 'd3')],
  });
  assert.equal(rounds.length, 1);
  assert.deepEqual(rounds[0].memberIds.sort(), ['anna', 'me']);
  assert.equal(rounds[0].group.id, 'crew', 'Tennis has the same people → folded into one round');
  assert.equal(rounds[0].includesMe, true);
  assert.deepEqual(cells['d2~evening'].friendIds, ['can']);
  assert.equal(cells['d3~evening'].mine, true);
});

test('a bigger group round wins over a subset; separate groups stay separate', () => {
  const { rounds } = computeRounds({
    viewerId: 'me',
    groups,
    slots: [slot('me', 'd1'), slot('anna', 'd1'), slot('max', 'd1'), slot('lisa', 'd1'), slot('can', 'd1')],
  });
  const keys = rounds.map((r) => `${r.group.id}:${r.memberIds.length}`).sort();
  assert.deepEqual(keys, ['crew:4', 'uni:2']);
});

test('rounds without me are listed so I can join', () => {
  const { rounds } = computeRounds({ viewerId: 'me', groups, slots: [slot('anna', 'd1'), slot('lisa', 'd1')] });
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].includesMe, false);
});

test('dice picks an idea and a host', () => {
  const r = rollDice(['🍺 Bier', '🎬 Kino'], [{ id: 'a' }, { id: 'b' }], () => 0.99);
  assert.deepEqual(r, { idea: '🎬 Kino', host: { id: 'b' } });
});
