// Integration test: real HTTP server + in-memory SQLite + demo seed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { seedDemo } from '../server/seed.js';
import { createWhatsApp } from '../server/integrations/whatsapp.js';

let server, base, seed, app;
const config = loadConfig({ demoMode: true, allowOpenSignup: false, publicUrl: '' });

before(async () => {
  const db = openDb(':memory:');
  seed = await seedDemo(db, { tz: config.tz });
  app = createApp({ config, db });
  server = http.createServer((req, res) => app.handle(req, res));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

/** Minimal client with its own cookie jar. */
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  };
}

test('unauthenticated access is rejected, demo login works', async () => {
  const c = client();
  assert.equal((await c('GET', '/api/posts')).status, 401);
  const me = await c('GET', '/api/me');
  assert.equal(me.data.demoUsers.length, 8);
  const login = await c('POST', '/api/auth/demo', { userId: seed.users.wolfgang.id });
  assert.equal(login.data.user.name, 'Wolfgang');
  const feed = await c('GET', '/api/posts');
  assert.ok(feed.data.posts.length >= 10);
  assert.ok(feed.data.posts.every((p, i, a) => i === 0 || a[i - 1].startsAt <= p.startsAt), 'sorted by start');
});

test('create → participate → comment → notifications', async () => {
  const wolfgang = client();
  await wolfgang('POST', '/api/auth/login', { email: 'wolfgang@demo.bock.app', password: 'demo1234' });
  const startsAt = new Date(Date.now() + 2 * 86400000).toISOString();
  const created = await wolfgang('POST', '/api/posts', {
    type: 'activity', title: 'Kino', startsAt, capacity: 1, groupIds: [seed.groups.crew],
  });
  assert.equal(created.status, 200);
  const post = created.data.post;
  assert.equal(post.emoji, '🎬');

  const anna = client();
  await anna('POST', '/api/auth/login', { email: 'anna@demo.bock.app', password: 'demo1234' });
  const joined = await anna('PUT', `/api/posts/${post.id}/participation`, { status: 'going' });
  assert.equal(joined.data.post.myStatus, 'going');

  const max = client();
  await max('POST', '/api/auth/login', { email: 'max@demo.bock.app', password: 'demo1234' });
  const full = await max('PUT', `/api/posts/${post.id}/participation`, { status: 'going' });
  assert.equal(full.status, 409, 'capacity enforced');
  assert.equal((await max('PUT', `/api/posts/${post.id}/participation`, { status: 'helping' })).status, 400);

  await anna('POST', `/api/posts/${post.id}/comments`, { body: 'Welcher Film?' });
  const notes = await wolfgang('GET', '/api/notifications');
  const types = notes.data.notifications.filter((n) => n.postId === post.id).map((n) => n.type);
  assert.deepEqual(types.sort(), ['comment', 'participation']);
});

test('group privacy: non-members cannot see or post', async () => {
  const lisa = client(); // Lisa is not in the Tennis group
  await lisa('POST', '/api/auth/login', { email: 'lisa@demo.bock.app', password: 'demo1234' });
  assert.equal((await lisa('GET', `/api/posts/${seed.posts.tennis.id}`)).status, 403);
  const feed = await lisa('GET', '/api/posts');
  assert.ok(!feed.data.posts.some((p) => p.id === seed.posts.tennis.id));
  const res = await lisa('POST', '/api/posts', {
    type: 'activity', title: 'x', startsAt: new Date(Date.now() + 3600e3).toISOString(), groupIds: [seed.groups.tennis],
  });
  assert.equal(res.status, 403);
});

test('invite link registration joins the group', async () => {
  const c = client();
  const closed = await c('POST', '/api/auth/register', { name: 'Tom', email: 'tom@example.com', password: 'secret1' });
  assert.equal(closed.status, 400, 'private app: no open signup');
  const g = app.services.groups.get(seed.users.wolfgang.id, seed.groups.crew);
  const reg = await c('POST', '/api/auth/register', { name: 'Tom', email: 'tom@example.com', password: 'secret1', inviteCode: g.inviteCode });
  assert.equal(reg.status, 200);
  assert.ok(reg.data.groups.some((x) => x.id === seed.groups.crew));
});

test('share link: public preview page and join via link', async () => {
  const page = await fetch(`${base}/e/${seed.posts.bar.shareCode}`).then((r) => r.text());
  assert.match(page, /og:title" content="🍺 Expertise Bar"/);
  assert.match(page, /Wolfgang ist dabei/);

  // Lisa is in the crew; Tom (new, via share link) is not in any group with the tennis post
  const tom = client();
  await tom('POST', '/api/auth/register', {
    name: 'Tina', email: 'tina@example.com', password: 'secret1', shareCode: seed.posts.tennis.shareCode,
  });
  const joined = await tom('POST', `/api/share/${seed.posts.tennis.shareCode}/join`);
  assert.equal(joined.data.post.myStatus, 'going');
  assert.equal((await tom('GET', `/api/posts/${seed.posts.tennis.id}`)).status, 200, 'participation grants visibility');
});

test('reminders are created once', () => {
  const soon = new Date(Date.parse(seed.posts.bar.startsAt) - 30 * 60_000);
  const first = app.services.posts.runReminders(soon);
  assert.ok(first >= 3); // host + Anna + Max
  assert.equal(app.services.posts.runReminders(soon), 0);
});

test('WhatsApp inbound message creates a post and returns a share link', () => {
  app.services.users.getByPhone = (phone) => (phone === '4915100000000' ? seed.users.max : null);
  const wa = createWhatsApp({ config, services: app.services, baseUrl: 'https://bock.example' });
  assert.match(wa.handleInbound({ from: '49000', text: 'Freitag 20 Uhr Bar' }), /noch mit keinem/);
  const reply = wa.handleInbound({ from: '4915100000000', text: 'Sonntag 15 Uhr Kaffee im Bonanza' });
  assert.match(reply, /https:\/\/bock\.example\/e\/\w+/);
  assert.match(wa.handleInbound({ from: '4915100000000', text: 'hmm' }), /nicht ganz verstanden/);
});

test('time slots: overlapping friends form a round with chat and notifications', async () => {
  const lisa = client();
  await lisa('POST', '/api/auth/login', { email: 'lisa@demo.bock.app', password: 'demo1234' });
  const sophie = client();
  await sophie('POST', '/api/auth/login', { email: 'sophie@demo.bock.app', password: 'demo1234' });
  const date = (await lisa('GET', '/api/slots')).data.today;

  await lisa('PUT', '/api/slots', { date, part: 'evening', free: true });
  const after = await sophie('PUT', '/api/slots', { date, part: 'evening', free: true });
  const round = after.data.rounds.find((r) => r.date === date && r.part === 'evening' && r.includesMe);
  assert.ok(round, 'round formed');
  assert.ok(round.members.some((m) => m.name === 'Lisa'));

  const notes = await lisa('GET', '/api/notifications');
  assert.ok(notes.data.notifications.some((n) => n.type === 'match' && n.data.date === date));

  const path = `/api/rounds/${round.group.id}/${date}/evening`;
  const posted = await sophie('POST', `${path}/messages`, { body: 'Kino?' });
  assert.equal(posted.data.round.messages.at(-1).body, 'Kino?');

  const max = client(); // in the crew, but not free → may read, may not write
  await max('POST', '/api/auth/login', { email: 'max@demo.bock.app', password: 'demo1234' });
  assert.equal((await max('GET', path)).data.round.includesMe, false);
  assert.equal((await max('POST', `${path}/messages`, { body: 'hi' })).status, 403);

  assert.equal((await lisa('PUT', '/api/slots', { date: '2020-01-01', part: 'evening', free: true })).status, 400);
  const off = await lisa('PUT', '/api/slots', { date, part: 'evening', free: false });
  assert.ok(!off.data.mySlots.some((s) => s.date === date && s.part === 'evening'));
});
