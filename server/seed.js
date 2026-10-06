// Seeds the SQLite database with the demo scenario. Run `npm run seed` to reset it.
import { fileURLToPath } from 'node:url';
import { createServices } from './app.js';
import { seedScenario } from './demo-scenario.js';

export async function seedDemo(db, { tz = 'Europe/Berlin', now = new Date(), reset = false } = {}) {
  if (reset) {
    db.exec(`DELETE FROM notifications; DELETE FROM comments; DELETE FROM participants; DELETE FROM post_groups;
             DELETE FROM posts; DELETE FROM group_members; DELETE FROM friend_groups; DELETE FROM sessions; DELETE FROM users;`);
  }
  return seedScenario(createServices(db, { tz }), { tz, now });
}

// `npm run seed` – reset and reseed
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { loadConfig } = await import('./config.js');
  const { openDb } = await import('./db.js');
  const config = loadConfig();
  const db = openDb(config.databasePath);
  await seedDemo(db, { tz: config.tz, reset: true });
  console.log(`🌱 Demo-Daten neu angelegt in ${config.databasePath}`);
  console.log('   Login: wolfgang@demo.bock.app / demo1234 (oder per Demo-Button)');
}
