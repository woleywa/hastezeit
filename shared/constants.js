// Shared domain constants – imported by the server (Node) and the browser (as ES module).

export const POST_TYPES = ['availability', 'activity', 'help_request', 'help_offer'];

export const TYPE_META = {
  availability: { label: 'Freie Zeit', emoji: '👋', tone: 'time' },
  activity: { label: 'Aktivität', emoji: '🎯', tone: 'activity' },
  help_request: { label: 'Hilfe gesucht', emoji: '🙋', tone: 'help' },
  help_offer: { label: 'Hilfe angeboten', emoji: '🤝', tone: 'help' },
};

// Which participation states make sense for which post type.
export const PARTICIPATION_BY_TYPE = {
  availability: ['free'],
  activity: ['going', 'maybe', 'declined'],
  help_request: ['helping'],
  help_offer: ['accepting'],
};

export const PARTICIPATION_STATUSES = ['going', 'maybe', 'declined', 'free', 'helping', 'accepting'];

// The "yes" status of each type: counted against capacity, used by share links.
export const POSITIVE_STATUS = {
  availability: 'free',
  activity: 'going',
  help_request: 'helping',
  help_offer: 'accepting',
};

export const COMMENT_KINDS = ['comment', 'suggestion'];

export const POST_SOURCES = ['app', 'nlp', 'whatsapp'];

export const NOTIFICATION_TYPES = ['post_created', 'participation', 'comment', 'suggestion', 'reminder', 'match', 'round_message'];

// Parts of the day people tick in the "Wann hast du Zeit?" grid. Overlaps form automatic rounds.
export const DAYPARTS = [
  { id: 'morning', label: 'Vormittag', short: 'Vorm.', emoji: '☀️', start: '09:00', end: '12:00' },
  { id: 'afternoon', label: 'Nachmittag', short: 'Nachm.', emoji: '🌤️', start: '13:00', end: '18:00' },
  { id: 'evening', label: 'Abend', short: 'Abend', emoji: '🌙', start: '18:00', end: '22:00' },
];
export const DAYPART_IDS = DAYPARTS.map((d) => d.id);
export const SLOT_DAYS_AHEAD = 27; // how far ahead people can mark time

// Quick idea chips for "Ich habe Zeit".
export const IDEAS = ['🍺 Bier', '🍜 Essen gehen', '☕ Kaffee', '🎬 Kino', '🏃 Sport', '🎲 Spieleabend', '🚶 Spazieren', '🛋 Chillen'];

export const AVATAR_COLORS = ['#ff8a65', '#ba68c8', '#4fc3f7', '#81c784', '#ffd54f', '#f06292', '#7986cb', '#4db6ac'];

export const LIMITS = {
  title: 120,
  description: 1000,
  location: 120,
  comment: 1000,
  idea: 30,
  ideas: 6,
  groupName: 40,
  userName: 40,
  capacity: 999,
};
