// Matching the names in an old cover's contributors text ("Tom, Mustafa, StefanH") to
// the people the new cover's teams offer. Per name, in this order:
// 1. A unique first name: "Mustafa" when there's only one Mustafa. Anything written
//    after the first name has to fit the last name ("StefanH": H fits Henzen).
// 2. The preferred names (preferred-names.ts), e.g. "Tom" → Tom Groeneveld.
// 3. The first name plus the start or initials of the last name: "Tom B" → Tom Brouwer.
// Capitals, spaces, punctuation and accents don't count ("Daniel" is Daniël).

import { nameForMatching } from '../../name-matching';
import { PREFERRED_NAMES } from './preferred-names';

/** A name for comparing: letters and numbers only, without capitals or accents ("Daniël" → "daniel"). */
const comparable = (name: string) => nameForMatching(name.normalize('NFD').replace(/\p{M}/gu, ''));

/** Whether two names are the same person's (see comparable). */
export const samePerson = (a: string, b: string) => comparable(a) !== '' && comparable(a) === comparable(b);

/**
 * A name's words: "Steven van Eck" → ["Steven", "van", "Eck"]. Initials stuck to the
 * first name are split off: "StefanH" and "Stefan H." → ["Stefan", "H"].
 */
function words(name: string): string[] {
  return name
    .replace(/(\p{Ll})(\p{Lu}+)(?=$|[^\p{L}])/gu, '$1 $2')
    .split(/[\s.]+/)
    .filter(Boolean);
}

/** Last name prefixes that written names may leave out ("Steven E" for Steven van Eck). */
const LAST_NAME_PREFIXES = new Set(['van', 'von', 'de', 'der', 'den', 'het', 't', 'ter', 'ten', 'te', 'op', 'in', 'aan', 'la', 'le', 'du', 'da', 'di']);

/**
 * Whether what's written after the first name ("H", "Henzen", "van E", "vE") fits
 * `lastName`: its start, or its initials, with or without prefixes like "van".
 * Nothing written fits any last name.
 */
function fitsLastName(written: string[], lastName: string[]): boolean {
  const typed = comparable(written.join(''));
  if (!typed) return true;
  const withoutPrefixes = lastName.filter((part) => !LAST_NAME_PREFIXES.has(comparable(part)));
  return [lastName, withoutPrefixes].some((parts) => {
    if (parts.length === 0) return false;
    const initials = parts.map((part) => comparable(part).charAt(0)).join('');
    return comparable(parts.join('')).startsWith(typed) || initials === typed;
  });
}

export interface Person {
  /** As on the employee component, e.g. "Tom Groeneveld". */
  fullName: string;
}

export type Match<T> = { person: T } | { problem: string };

/** Who `written` is among `people` (each person once, see samePerson), or why it couldn't be matched. */
export function matchPerson<T extends Person>(written: string, people: readonly T[]): Match<T> {
  const [firstName = '', ...rest] = words(written);
  const sameFirstName = people.filter((person) => samePerson(words(person.fullName)[0] ?? '', firstName));
  const fitting = sameFirstName.filter((person) => fitsLastName(rest, words(person.fullName).slice(1)));

  // 1. A unique first name, if the rest fits its last name.
  if (sameFirstName.length === 1 && fitting.length === 1) return { person: fitting[0] };

  // 2. The preferred names.
  const preferred = Object.entries(PREFERRED_NAMES).find(([writtenAs]) => samePerson(writtenAs, written));
  if (preferred) {
    const person = people.find((p) => samePerson(p.fullName, preferred[1]));
    if (person) return { person };
    return { problem: `Couldn't match '${written}': ${preferred[1]} (preferred names) isn't in any team's list` };
  }

  // 3. The first name plus the start or initials of the last name.
  if (fitting.length === 1) return { person: fitting[0] };
  if (fitting.length > 1) return { problem: `Couldn't match '${written}': ${fitting.map((p) => p.fullName).join(', ')}` };
  return { problem: `Couldn't match '${written}'` };
}

/** The names in a contributors text: "Tom, Mustafa & StefanH" → ["Tom", "Mustafa", "StefanH"]. */
export function splitNames(text: string): string[] {
  return text
    .split(/[,;&/+|•\n\r]|\s+(?:en|and)\s+/i)
    .map((name) => name.trim())
    .filter((name) => comparable(name) !== '');
}
