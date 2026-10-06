// Picks a fitting emoji from free text. Cheap heuristic, good enough to make cards recognisable.
import { TYPE_META } from './constants.js';

const KEYWORDS = [
  [/tennis|padel/, '🎾'],
  [/fu(ss|ß)ball|kicken/, '⚽'],
  [/basketball/, '🏀'],
  [/volleyball|beachvolleyball/, '🏐'],
  [/tischtennis|ping ?pong/, '🏓'],
  [/boulder|kletter/, '🧗'],
  [/schwimm|baden|see\b|strandbad/, '🏊'],
  [/lauf|joggen|run/, '🏃'],
  [/fahrrad|radtour|rad\b|bike/, '🚲'],
  [/wander|hike/, '🥾'],
  [/yoga/, '🧘'],
  [/gym|fitness|training/, '💪'],
  [/bier|bar\b|kneipe|späti|drinks?|cocktail/, '🍺'],
  [/wein/, '🍷'],
  [/kaffee|coffee|café|cafe/, '☕'],
  [/brunch|frühstück/, '🥐'],
  [/pizza/, '🍕'],
  [/burger/, '🍔'],
  [/sushi/, '🍣'],
  [/ramen|essen|dinner|abendessen|restaurant|vietnames|thai|döner/, '🍜'],
  [/grill|bbq/, '🔥'],
  [/kochen/, '🧑‍🍳'],
  [/kino|film|movie/, '🎬'],
  [/konzert|gig|festival|musik/, '🎵'],
  [/party|feiern|geburtstag|club/, '🎉'],
  [/spiel|brettspiel|poker|kartenspiel|spieleabend/, '🎲'],
  [/museum|ausstellung|galerie/, '🖼️'],
  [/theater/, '🎭'],
  [/couch|sofa|möbel/, '🛋'],
  [/umzug|kartons|kisten|transport/, '📦'],
  [/auto|fahren|transporter/, '🚗'],
  [/ikea|aufbau|aufbauen|regal|bohren|werkzeug/, '🔧'],
  [/garten|pflanzen|blumen/, '🌱'],
  [/hund|gassi/, '🐕'],
  [/katze/, '🐈'],
  [/kinder|babysit/, '👶'],
  [/laptop|computer|pc|wlan|handy/, '💻'],
  [/lernen|nachhilfe|bewerbung/, '📚'],
  [/flughafen|bahnhof|abholen/, '🧳'],
  [/spazier|park/, '🚶'],
  [/picknick/, '🧺'],
  [/chill|abhängen/, '🛋'],
];

export function guessEmoji(text = '', type = 'activity') {
  const t = String(text).toLowerCase();
  for (const [re, emoji] of KEYWORDS) {
    if (re.test(t)) return emoji;
  }
  return TYPE_META[type]?.emoji ?? '✨';
}
