import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // no .env file – rely on real environment variables / defaults
}

const env = process.env;
const bool = (v, fallback) => (v === undefined || v === '' ? fallback : ['1', 'true', 'yes'].includes(v.toLowerCase()));

export function loadConfig(overrides = {}) {
  return {
    port: Number(env.PORT ?? 3000),
    publicUrl: (env.PUBLIC_URL ?? '').replace(/\/$/, ''),
    databasePath: path.resolve(ROOT, env.DATABASE_PATH ?? './data/bock.db'),
    tz: env.APP_TZ ?? 'Europe/Berlin',
    appName: env.APP_NAME ?? 'Bock',
    demoMode: bool(env.DEMO_MODE, true),
    allowOpenSignup: bool(env.ALLOW_OPEN_SIGNUP, false),
    cookieSecure: bool(env.COOKIE_SECURE, false),
    whatsapp: {
      enabled: bool(env.WHATSAPP_ENABLED, false),
      verifyToken: env.WHATSAPP_VERIFY_TOKEN ?? '',
      appSecret: env.WHATSAPP_APP_SECRET ?? '',
      accessToken: env.WHATSAPP_ACCESS_TOKEN ?? '',
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    },
    ...overrides,
  };
}
