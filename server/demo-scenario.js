// Demo friends and plans – relative to "now", so the prototype always looks alive.
import { dateParts, zonedToDate, addDays } from '../shared/time.js';

const FRIENDS = [
  { key: 'wolfgang', name: 'Wolfgang', emoji: '😎', color: '#7986cb' },
  { key: 'anna', name: 'Anna', emoji: '🌻', color: '#ff8a65' },
  { key: 'max', name: 'Max', emoji: '💪', color: '#4fc3f7' },
  { key: 'lisa', name: 'Lisa', emoji: '🚲', color: '#81c784' },
  { key: 'jonas', name: 'Jonas', emoji: '🎸', color: '#ffd54f' },
  { key: 'sophie', name: 'Sophie', emoji: '🧗', color: '#f06292' },
  { key: 'can', name: 'Can', emoji: '🎲', color: '#4db6ac' },
  { key: 'mia', name: 'Mia', emoji: '🎬', color: '#ba68c8' },
];

const GROUPS = [
  { key: 'crew', name: 'Berlin Crew', emoji: '🐻', members: ['wolfgang', 'anna', 'max', 'lisa', 'jonas', 'sophie', 'can', 'mia'] },
  { key: 'tennis', name: 'Tennis', emoji: '🎾', members: ['wolfgang', 'anna', 'max', 'jonas', 'sophie'] },
  { key: 'uni', name: 'Uni Freunde', emoji: '🎓', members: ['anna', 'lisa', 'can', 'mia', 'wolfgang'] },
];

/**
 * Creates the demo friends, groups and plans through the given services
 * (`users.register`, `groups.create/addMember`, `posts.create/setParticipation/addComment`).
 * Pure – used by the SQLite seed and by the in-browser web demo.
 */
export async function seedScenario(s, { tz = 'Europe/Berlin', now = new Date() } = {}) {
  const today = dateParts(now, tz);

  /** Next occurrence of weekday `wd` (0 = So) at `time`, at least 1h from now. */
  const next = (wd, time) => {
    let date = addDays(today.date, (wd - today.weekday + 7) % 7);
    if (zonedToDate(date, time, tz).getTime() < now.getTime() + 3600_000) date = addDays(date, 7);
    return zonedToDate(date, time, tz).toISOString();
  };
  /** In `days` days at `time` (today → tomorrow if already past). */
  const inDays = (days, time) => {
    let date = addDays(today.date, days);
    if (zonedToDate(date, time, tz).getTime() < now.getTime() + 1800_000) date = addDays(date, 1);
    return zonedToDate(date, time, tz).toISOString();
  };
  const plus = (iso, hours) => new Date(Date.parse(iso) + hours * 3600_000).toISOString();

  const u = {};
  for (const f of FRIENDS) {
    u[f.key] = await s.users.register({
      name: f.name,
      email: `${f.key}@demo.bock.app`,
      password: 'demo1234',
      emoji: f.emoji,
      color: f.color,
      isDemo: true,
    });
  }
  const g = {};
  for (const grp of GROUPS) {
    const [owner, ...rest] = grp.members;
    g[grp.key] = s.groups.create(u[owner].id, { name: grp.name, emoji: grp.emoji }).id;
    for (const m of rest) s.groups.addMember(g[grp.key], u[m].id);
  }

  const post = (author, data) => s.posts.create(u[author].id, { ...data, groupIds: data.groups.map((k) => g[k]) });
  const join = (who, p, status) => s.posts.setParticipation(u[who].id, p.id, status);
  const comment = (who, p, body, kind = 'comment') => s.posts.addComment(u[who].id, p.id, { body, kind });

  // Mia – free tonight (or tomorrow evening if it's already late)
  const hour = Number(today.time.slice(0, 2));
  const miaStart = hour < 21 ? inDays(0, `${String(Math.max(19, hour + 1)).padStart(2, '0')}:00`) : inDays(1, '19:00');
  const mia = post('mia', {
    type: 'availability',
    startsAt: miaStart,
    endsAt: plus(miaStart, 3),
    description: 'Noch nichts vor. Couch oder raus – Hauptsache nicht allein 😅',
    ideas: ['🍺 Bier', '🍜 Essen gehen', '🎬 Kino'],
    groups: ['crew', 'uni'],
  });
  join('can', mia, 'free');
  comment('can', mia, '🎬 Neuer Film im Babylon um 20:30?', 'suggestion');

  // Lisa – help tomorrow
  const lisaHelp = post('lisa', {
    type: 'help_request',
    title: 'IKEA-Regal aufbauen',
    description: 'Hab zwei linke Hände und ein PAX-Regal 🙈 Akkuschrauber wäre super.',
    startsAt: inDays(1, '15:00'),
    location: 'Prenzlauer Berg',
    capacity: 1,
    groups: ['crew', 'uni'],
  });

  // Max – free for brunch tomorrow
  const maxBrunch = inDays(1, '11:00');
  post('max', {
    type: 'availability',
    startsAt: maxBrunch,
    endsAt: plus(maxBrunch, 3),
    description: 'Jemand Lust auf Brunch?',
    ideas: ['🥐 Brunch', '🚶 Spazieren'],
    groups: ['crew'],
  });

  // Wolfgang – Tennis Tuesday
  const tennisStart = next(2, '18:00');
  const tennis = post('wolfgang', {
    type: 'activity',
    title: 'Tennis',
    description: 'Jemand Lust auf Tennis? Platz ist gebucht.',
    startsAt: tennisStart,
    endsAt: plus(tennisStart, 2),
    location: 'Tempelhof',
    groups: ['tennis'],
  });
  for (const who of ['anna', 'max', 'jonas', 'sophie']) join(who, tennis, 'going');

  // Anna – free Tuesday 18–20
  const annaStart = next(2, '18:00');
  const anna = post('anna', {
    type: 'availability',
    startsAt: annaStart,
    endsAt: plus(annaStart, 2),
    description: 'Nach der Arbeit frei.',
    ideas: ['🍺 Bier', '🍜 Essen gehen'],
    groups: ['crew', 'uni'],
  });
  join('mia', anna, 'free');

  // Sophie – Bouldern Wednesday
  const boulder = post('sophie', {
    type: 'activity',
    title: 'Bouldern',
    description: 'Anfänger:innen willkommen, ich zeig euch die Basics.',
    startsAt: next(3, '19:00'),
    location: 'Ostbloc, Rummelsburg',
    capacity: 4,
    groups: ['crew'],
  });
  join('can', boulder, 'going');
  join('wolfgang', boulder, 'maybe');

  // Can – Spieleabend Thursday
  const games = post('can', {
    type: 'activity',
    title: 'Spieleabend',
    description: 'Catan & Pizza. Bringt Snacks mit!',
    startsAt: next(4, '20:00'),
    location: 'Bei Can, Kreuzberg',
    capacity: 6,
    groups: ['uni'],
  });
  for (const who of ['mia', 'lisa', 'anna']) join(who, games, 'going');

  // Wolfgang – Expertise Bar Friday
  const bar = post('wolfgang', {
    type: 'activity',
    title: 'Expertise Bar',
    description: 'Feierabendbier zum Wochenende. Wer kommt mit?',
    startsAt: next(5, '20:00'),
    location: 'Expertise Bar, Neukölln',
    groups: ['crew'],
  });
  join('anna', bar, 'going');
  join('max', bar, 'going');
  join('can', bar, 'maybe');
  join('lisa', bar, 'declined');
  comment('anna', bar, 'Bin dabei! Komme evtl. 20 Minuten später 🙈');
  comment('max', bar, 'Erste Runde geht auf mich 🍻');

  // Max – Couch Saturday
  const couch = post('max', {
    type: 'help_request',
    title: 'Couch runtertragen',
    description: 'Meine Couch muss runter. Brauche 2 starke Menschen 😄',
    startsAt: next(6, '14:00'),
    location: 'Friedrichshain, 4. OG ohne Aufzug',
    capacity: 2,
    groups: ['crew'],
  });
  join('jonas', couch, 'helping');
  comment('jonas', couch, 'Bin dabei, bring Handschuhe mit 💪');
  comment('max', couch, 'Ihr seid die Besten. Pizza geht auf mich 🍕');

  // Lisa – bike tour Sunday
  const bikeStart = next(0, '11:00');
  const bike = post('lisa', {
    type: 'activity',
    title: 'Fahrradtour Tempelhofer Feld',
    description: 'Ganz entspannt, danach Picknick. Decke bring ich mit.',
    startsAt: bikeStart,
    endsAt: plus(bikeStart, 3),
    location: 'Tempelhofer Feld, Eingang Oderstraße',
    groups: ['crew'],
  });
  join('sophie', bike, 'going');
  join('wolfgang', bike, 'going');
  join('anna', bike, 'maybe');

  // Jonas – offers a van Sunday
  const vanStart = next(0, '10:00');
  post('jonas', {
    type: 'help_offer',
    title: 'Transporter frei',
    emoji: '🚐',
    description: 'Hab Sonntag einen Transporter gemietet und noch Platz. Wer was zu transportieren hat: melden!',
    startsAt: vanStart,
    endsAt: plus(vanStart, 6),
    capacity: 2,
    groups: ['crew'],
  });

  // "Wann hast du Zeit?" – ticked day parts; overlaps become automatic rounds.
  const day = (n) => addDays(today.date, n);
  const free = (who, n, part) => s.slots.set(u[who].id, { date: day(n), part, free: true });
  for (const who of ['anna', 'max', 'mia', 'wolfgang']) free(who, 1, 'evening');
  for (const who of ['lisa', 'sophie']) free(who, 2, 'afternoon');
  for (const who of ['can', 'lisa', 'wolfgang']) free(who, 3, 'evening');
  free('wolfgang', 4, 'evening');
  for (const who of ['max', 'jonas']) free(who, 5, 'morning');
  for (const who of ['anna', 'sophie', 'jonas', 'can', 'mia']) free(who, 6, 'afternoon');
  free('anna', 4, 'afternoon');
  free('mia', 2, 'evening');
  const say = (who, n, part, body) => s.slots.postMessage(u[who].id, g.crew, day(n), part, body);
  say('anna', 1, 'evening', 'Yes, wir sind schon vier! Lust auf Burger? 🍔');
  say('max', 1, 'evening', 'Immer. Oder Kicker in der Kneipe?');
  say('mia', 1, 'evening', 'Burger + danach Kicker 😄');

  return { users: u, groups: g, posts: { mia, lisaHelp, tennis, anna, bar, couch, bike } };
}
