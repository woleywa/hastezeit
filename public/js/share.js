// Sharing: WhatsApp (official click-to-chat link), native share sheet (Web Share API), copy link.
import { html, openSheet, closeSheet, toast } from './ui.js';
import { store } from './store.js';
import { spokenWhen } from '/shared/format.js';

const LINES = {
  activity: { mine: 'Ich bin da. Wer kommt mit?', other: 'Ich bin dabei – wer noch?' },
  availability: { mine: 'Ich hab Zeit – wer hat Bock?', other: 'Wer ist noch frei?' },
  help_request: { mine: 'Wer kann helfen? 🙏', other: 'Wer kann helfen? 🙏' },
  help_offer: { mine: 'Braucht jemand Hilfe?', other: 'Braucht jemand Hilfe?' },
};

const base = () => store.app.publicUrl || location.origin;
export const postUrl = (post) => `${base()}/e/${post.shareCode}`;
export const inviteUrl = (group) => `${base()}/i/${group.inviteCode}`;

export function postShareText(post) {
  const line = LINES[post.type][post.isMine ? 'mine' : 'other'];
  const what = post.type === 'availability' ? `${post.author.name} hat Zeit` : post.title;
  return `${post.emoji} ${spokenWhen(post.startsAt, post.endsAt)} – ${what}\n${line}\n${postUrl(post)}`;
}

export function inviteShareText(group) {
  return `${group.emoji ?? '👥'} Komm in unsere Gruppe „${group.name}“ – da sehen wir, wer wann Zeit hat und was geht.\n${inviteUrl(group)}`;
}

export const whatsappHref = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Link kopiert 📋');
  } catch {
    toast(text, { duration: 8000 });
  }
}

/** Opens the share sheet with WhatsApp first (the main channel), then native share and copy. */
export function openShareSheet({ title = 'Teilen', text, url }) {
  openSheet(
    html`<h2>${title}</h2>
      <div class="share-preview">${text}</div>
      ${store.app.webDemo ? html`<p class="hint" style="margin:-6px 4px 14px">Demo: Der Link funktioniert erst, wenn die App unter eigener Domain läuft.</p>` : ''}
      <div class="stack">
        <a class="btn whatsapp block lg" href="${whatsappHref(text)}" target="_blank" rel="noopener" data-action="sheet-close">
          <span aria-hidden="true">💬</span> In WhatsApp teilen
        </a>
        ${navigator.share ? html`<button class="btn dark block lg" data-action="native-share">📤 Andere App…</button>` : ''}
        <button class="btn ghost block lg" data-action="copy-link">🔗 Link kopieren</button>
      </div>`,
    {
      'sheet-close': () => setTimeout(closeSheet, 50),
      'native-share': async () => {
        try {
          await navigator.share({ text });
          closeSheet();
        } catch {
          /* user cancelled */
        }
      },
      'copy-link': () => {
        copy(url);
        closeSheet();
      },
    },
  );
}

export const sharePost = (post) =>
  openShareSheet({ title: 'Mit Freunden teilen', text: postShareText(post), url: postUrl(post) });

export const shareInvite = (group) =>
  openShareSheet({ title: `In „${group.name}“ einladen`, text: inviteShareText(group), url: inviteUrl(group) });
