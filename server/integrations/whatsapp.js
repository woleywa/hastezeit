// WhatsApp channel – prepared for the *official* WhatsApp Business Cloud API (Meta). Disabled by default.
//
// Flow once enabled:
//   user → WhatsApp "Freitag 20 Uhr Expertise Bar" → Meta webhook → handleInbound()
//        → interpret() → posts.create(source: 'whatsapp') → reply with share link app.domain/e/XYZ
//
// No unofficial libraries, no automation of private accounts. Users are matched by their
// verified phone number (users.phone, E.164 without "+", as Meta sends it).
import crypto from 'node:crypto';
import { interpret } from '../domain/interpret.js';
import { spokenWhen } from '../../shared/format.js';

export function createWhatsApp({ config, services, baseUrl }) {
  const wa = config.whatsapp;

  /** Validates Meta's X-Hub-Signature-256 header against the raw request body. */
  function verifySignature(rawBody, header = '') {
    if (!wa.appSecret) return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', wa.appSecret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(header);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /** Extracts `{ from, text }` messages from a Cloud API webhook payload. */
  function extractMessages(payload) {
    const out = [];
    for (const entry of payload?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const msg of change.value?.messages ?? []) {
          if (msg.type === 'text' && msg.text?.body) out.push({ from: msg.from, text: msg.text.body });
        }
      }
    }
    return out;
  }

  /** Core logic – independent of transport, unit-testable. Returns the reply text. */
  function handleInbound({ from, text, now = new Date() }) {
    const user = services.users.getByPhone(from);
    if (!user) {
      return `Hi! Diese Nummer ist noch mit keinem ${config.appName}-Konto verknüpft. Öffne ${baseUrl} und hinterlege deine Nummer im Profil.`;
    }
    const draft = interpret(text, { now, tz: config.tz });
    if (!draft.complete) {
      return 'Hab ich nicht ganz verstanden 🤔 Probier z. B. „Freitag 20 Uhr Expertise Bar“ oder „Hab Zeit Di 18-20“.';
    }
    const groupIds = services.groups.groupIdsFor(user.id);
    if (!groupIds.length) return 'Du bist noch in keiner Gruppe. Lass dich zuerst einladen 🙂';
    const post = services.posts.create(user.id, { ...draft, groupIds, source: 'whatsapp' });
    const when = spokenWhen(post.startsAt, post.endsAt, { tz: config.tz, now });
    return `${post.emoji} ${when} – ${post.title}\nIst eingetragen! Teil den Link mit deinen Leuten:\n${baseUrl}/e/${post.shareCode}`;
  }

  async function send(to, text) {
    const res = await fetch(`https://graph.facebook.com/v21.0/${wa.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${wa.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
    });
    if (!res.ok) throw new Error(`WhatsApp send failed: ${res.status}`);
  }

  return { enabled: wa.enabled, verifySignature, extractMessages, handleInbound, send };
}
