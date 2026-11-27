// Name matching, used for page names (clean-up of existing files), product names
// (the thumbnail's Product variants) and the suggested file name: names count as the
// same when only capitals, emojis, symbols, punctuation or spacing differ.

// Emojis: keycaps (like the "1" and "#" keycap emojis) as a whole, pictographs, skin
// tones, country flags, the tag characters of flags like England's, and the joiners and
// text/emoji style selectors between parts. Digits, # and * are only removed as part
// of a keycap.
const EMOJI =
  /[0-9#*]\ufe0f?\u20e3|\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[\u{E0020}-\u{E007F}]|\u200d|\ufe0e|\ufe0f|\u20e3/gu;

/**
 * Everything but letters and numbers (with their accents): symbols like "❖" or "↪",
 * punctuation like ":" or "-", and spacing.
 */
const NOT_LETTER_OR_NUMBER = /[^\p{L}\p{M}\p{N}]/gu;

/**
 * A name as letters and numbers only, without capitals, e.g.
 * "🚧  Concept: X" → "conceptx", "❖  Local components" → "localcomponents".
 * Emojis go first, so a keycap like "1️⃣" doesn't leave its digit behind.
 */
export const nameForMatching = (name: string) => name.replace(EMOJI, '').replace(NOT_LETTER_OR_NUMBER, '').toLowerCase();

/** Same name apart from capitals, emojis, symbols, punctuation and spacing (e.g. "🧩 Local Components" and "❖ Local components"). */
export const namesMatch = (a: string, b: string) => nameForMatching(a) !== '' && nameForMatching(a) === nameForMatching(b);

/** The words of a name, as in nameForMatching, e.g. "Contractor Portal - Hosts" → ["contractor", "portal", "hosts"]. */
const wordsForMatching = (name: string) =>
  name.replace(EMOJI, ' ').replace(NOT_LETTER_OR_NUMBER, ' ').toLowerCase().split(' ').filter(Boolean);

/**
 * Whether `name` contains `part` as whole words, matched like namesMatch, e.g.
 * "Contractor Portal - Hosts" contains "Contractor Portal" (and "contractorportal"),
 * but "Firms overview" doesn't contain "RMS".
 */
export function nameContains(name: string, part: string): boolean {
  const target = nameForMatching(part);
  if (!target) return false;
  const words = wordsForMatching(name);
  for (let start = 0; start < words.length; start++) {
    let joined = '';
    for (let end = start; end < words.length && joined.length < target.length; end++) {
      joined += words[end];
      if (joined === target) return true;
    }
  }
  return false;
}
