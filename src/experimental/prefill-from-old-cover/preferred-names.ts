// Preferred names: how a person is written in old covers' contributors text, and who
// that is, by their full name as on the employee component ("PM / Tom Groeneveld").
//
// Used for names that can't be matched otherwise: a first name shared by several
// people ("Tom"), or a nickname ("Musti"). Matched ignoring capitals, spaces,
// punctuation and accents, so 'Stefan H' also covers "StefanH" and "Stefan H.".
//
// Add one line per name:  'Written as': 'Full Name',

export const PREFERRED_NAMES: Readonly<Record<string, string>> = {
  'Tom': 'Tom Groeneveld',
  'Musti': 'Mustafa Kurt',
  'StefanH': 'Stefan Henzen',
};
