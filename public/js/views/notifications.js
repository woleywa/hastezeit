import { api } from '../api.js';
import { store } from '../store.js';
import { html, avatar, relativeTime } from '../ui.js';
import { emptyState, updateBadges, slotDayLabel } from '../components.js';
import { DAYPARTS } from '/shared/constants.js';

const roundWhen = (d) => `${slotDayLabel(d.date)} ${DAYPARTS.find((p) => p.id === d.part)?.label ?? ''}`;
const notifHref = (n) =>
  n.data?.groupId && n.data?.date && n.data?.part
    ? `#/round/${n.data.groupId}/${n.data.date}/${n.data.part}`
    : n.postId
      ? `#/post/${n.postId}`
      : '#/';
import { firstName } from '/shared/format.js';

const STATUS_TEXT = {
  going: 'ist dabei bei',
  maybe: 'ist vielleicht dabei bei',
  free: 'ist auch frei',
  helping: 'hilft dir bei',
  accepting: 'nimmt dein Angebot an:',
};

function text(n) {
  const who = n.actor ? firstName(n.actor.name) : 'Jemand';
  const title = n.post?.title ?? '';
  switch (n.type) {
    case 'post_created':
      return n.post?.type === 'help_request' ? html`<strong>${who}</strong> braucht Hilfe: ${title}`
        : n.post?.type === 'help_offer' ? html`<strong>${who}</strong> bietet Hilfe an: ${title}`
          : html`<strong>${who}</strong> hat was vor: ${title}`;
    case 'participation':
      return n.data.status === 'free'
        ? html`<strong>${who}</strong> ist auch frei 🙌`
        : html`<strong>${who}</strong> ${STATUS_TEXT[n.data.status] ?? 'reagiert auf'} „${title}“`;
    case 'comment':
      return html`<strong>${who}</strong> zu „${title}“: ${n.data.preview ?? ''}`;
    case 'suggestion':
      return html`<strong>${who}</strong> schlägt vor: ${n.data.preview ?? ''}`;
    case 'match':
      return html`<strong>${who}</strong> hat auch ${roundWhen(n.data)} Zeit – ihr seid jetzt ${n.data.count} 🎉`;
    case 'round_message':
      return html`<strong>${who}</strong> in der Runde ${roundWhen(n.data)}: ${n.data.preview ?? ''}`;
    case 'reminder':
      return html`⏰ Gleich geht's los: <strong>${title}</strong>`;
    default:
      return title;
  }
}

export default async function notificationsView() {
  const { notifications } = await api.notifications();
  if (notifications.some((n) => !n.read)) {
    api.readNotifications().then(() => {
      store.unread = 0;
      updateBadges();
    });
  }
  return {
    html: html`
      <header class="topbar compact"><button class="icon-btn" data-action="back" aria-label="Zurück">←</button><h1>Neuigkeiten</h1></header>
      ${notifications.length
        ? html`<div class="list" style="margin-top:8px">${notifications.map(
            (n) => html`<a class="notif ${n.read ? '' : 'unread'}" href="${notifHref(n)}">
              ${n.actor ? avatar(n.actor, 'md') : html`<span class="avatar md" style="--c:var(--surface-2)">${n.post?.emoji ?? '🔔'}</span>`}
              <div class="n-text">${text(n)}<div class="n-time">${relativeTime(n.createdAt)}</div></div>
              ${n.post?.emoji ? html`<span style="font-size:22px">${n.post.emoji}</span>` : ''}
            </a>`,
          )}</div>`
        : emptyState('🔔', 'Alles ruhig', 'Hier siehst du, wenn Freunde mitmachen, helfen oder kommentieren.')}`,
  };
}
