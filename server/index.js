import http from 'node:http';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { seedDemo } from './seed.js';

const config = loadConfig();
const db = openDb(config.databasePath);
const app = createApp({ config, db });

if (config.demoMode && db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
  await seedDemo(db, { tz: config.tz });
  console.log('🌱 Demo-Daten angelegt.');
}

// Reminder job – an in-process interval is plenty for 20–100 users.
const REMINDER_INTERVAL = 5 * 60_000;
const runReminders = () => {
  try {
    app.services.posts.runReminders();
  } catch (err) {
    console.error('[reminders]', err);
  }
};
runReminders();
setInterval(runReminders, REMINDER_INTERVAL).unref();

http.createServer((req, res) => app.handle(req, res)).listen(config.port, () => {
  console.log(`🚀 ${config.appName} läuft auf http://localhost:${config.port}${config.demoMode ? '  (Demo-Modus)' : ''}`);
});
