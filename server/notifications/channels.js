// Delivery channels. A channel is `{ name, deliver(notificationRow) }`.
//
// To add Web Push later:
//   1. add a `push_subscriptions` table (user_id, endpoint, p256dh, auth)
//   2. generate VAPID keys (free, self-hosted – no paid service needed)
//   3. implement `webPushChannel.deliver()` that renders a short text (see describe()) and sends it
//   4. register it in createNotificationService({ channels: [inAppChannel, webPushChannel] })
// Native iOS/Android push (via Capacitor) would be another channel using APNs/FCM.

export const inAppChannel = {
  name: 'in-app',
  // Stored row is the in-app notification; the client polls for it. Nothing else to do.
  deliver() {},
};

/** Human readable one-liner for push/WhatsApp channels. Mirrors the client-side renderer. */
export function describe(n, { actorName = 'Jemand', postTitle = '' } = {}) {
  switch (n.type) {
    case 'post_created':
      return `${actorName}: ${postTitle}`;
    case 'participation':
      return `${actorName} ist bei „${postTitle}“ dabei`;
    case 'comment':
      return `${actorName} hat „${postTitle}“ kommentiert`;
    case 'suggestion':
      return `${actorName} hat etwas vorgeschlagen`;
    case 'reminder':
      return `Gleich geht's los: ${postTitle}`;
    default:
      return postTitle;
  }
}
