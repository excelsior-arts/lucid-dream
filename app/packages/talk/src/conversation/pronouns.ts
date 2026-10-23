/* Who is "she", and who is "he".
 *
 * Every prompt in this package and every band of the standing was written
 * in third person for two people: a character who was "she" and a player
 * who was "he". That was the first pill and the first player, and it was
 * carried into the narrator over a walk, which is not a she, and will be
 * carried into whoever plays next, who may not be a he. So the pronouns are
 * two words in two places -- `pronouns:` in a persona's header, and
 * `player.pronouns` in the game's config -- and everything written about
 * either of them is written once, in tokens, and said in the right words
 * here.
 *
 * The tokens read as the sentence would with "she" and "he" in it, so a
 * prompt is still readable in its file:
 *
 *   {S} {v:is} fond of {him}.    ->  She is fond of him. / They are fond of them.
 *   {He} {w:has} a dog.          ->  He has a dog. / She has a dog.
 *
 * The character's forms are {S} {s} {o} {p} {self}, capitalised as written
 * and {SS} {OO} {PP} shouted; the player's are {he} {him} {his} {himself},
 * {He} {Him} {His}, {HE} {HIM} {HIS}. A verb after either agrees through
 * {v:...} for the character and {w:...} for the player, written in the
 * third person singular the way the sentence read before.
 */

export type Pronoun = 'he' | 'she' | 'they' | 'it';
export const PRONOUNS: readonly Pronoun[] = ['he', 'she', 'they', 'it'];

export interface Forms {
  subject: string;
  object: string;
  possessive: string;
  reflexive: string;
  plural: boolean;
}

const FORMS: Record<Pronoun, Forms> = {
  he: {subject: 'he', object: 'him', possessive: 'his', reflexive: 'himself', plural: false},
  she: {subject: 'she', object: 'her', possessive: 'her', reflexive: 'herself', plural: false},
  they: {subject: 'they', object: 'them', possessive: 'their', reflexive: 'themselves', plural: true},
  it: {subject: 'it', object: 'it', possessive: 'its', reflexive: 'itself', plural: false},
};

/** The word, or the default when a file says something that is not one. */
export function pronoun(v: unknown, or: Pronoun): Pronoun {
  const s = String(v ?? '').trim().toLowerCase();
  return (PRONOUNS as readonly string[]).includes(s) ? (s as Pronoun) : or;
}

export const forms = (p: Pronoun): Forms => FORMS[p];

/** A verb written in the third person singular, agreed with a plural
    subject when the subject is one: is -> are, has -> have, keeps -> keep,
    misses -> miss, tries -> try. Anything else is left as it was. */
export function conjugate(verb: string, plural: boolean): string {
  if (!plural) return verb;
  const special: Record<string, string> = {is: 'are', was: 'were', has: 'have', does: 'do', goes: 'go', "isn't": "aren't", "doesn't": "don't", "hasn't": "haven't", "wasn't": "weren't"};
  if (special[verb]) return special[verb]!;
  if (/(ss|sh|ch|x|z|o)es$/.test(verb)) return verb.slice(0, -2);
  if (/[^aeiou]ies$/.test(verb)) return verb.slice(0, -3) + 'y';
  if (/s$/.test(verb) && !/ss$/.test(verb)) return verb.slice(0, -1);
  return verb;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Two people, for a prompt: the one speaking, and the one spoken to. */
export interface Voice {
  self: Pronoun;
  other: Pronoun;
}

export const DEFAULT_VOICE: Voice = {self: 'she', other: 'he'};

/** The plain tokens for a voice. Verbs are not here: see `say`. */
export function tokens(v: Voice): Record<string, string> {
  const s = FORMS[v.self];
  const o = FORMS[v.other];
  return {
    S: cap(s.subject), s: s.subject, SS: s.subject.toUpperCase(),
    O: cap(s.object), o: s.object, OO: s.object.toUpperCase(),
    P: cap(s.possessive), p: s.possessive, PP: s.possessive.toUpperCase(),
    self: s.reflexive, Self: cap(s.reflexive),
    He: cap(o.subject), he: o.subject, HE: o.subject.toUpperCase(),
    Him: cap(o.object), him: o.object, HIM: o.object.toUpperCase(),
    His: cap(o.possessive), his: o.possessive, HIS: o.possessive.toUpperCase(),
    himself: o.reflexive, Himself: cap(o.reflexive),
  };
}

/** A template said in a voice: the tokens above, and `{v:verb}` agreed with
    the character, `{w:verb}` with the player. One pass, so nothing put in
    is read again; any other `{name}` is left for the caller's own fill, and
    `values` are put in in the same pass when given. */
export function say(template: string, v: Voice, values: Record<string, string> = {}): string {
  const t = tokens(v);
  const s = FORMS[v.self];
  const o = FORMS[v.other];
  return template.replace(/\{(\w+)(?::([\w']+))?\}/g, (whole, name: string, verb?: string) => {
    if (verb !== undefined) {
      if (name === 'v') return conjugate(verb, s.plural);
      if (name === 'w') return conjugate(verb, o.plural);
      if (name === 'V') return cap(conjugate(verb, s.plural));
      if (name === 'W') return cap(conjugate(verb, o.plural));
      return whole;
    }
    return values[name] ?? t[name] ?? whole;
  });
}

/** The words for one person, for prose written in code rather than in a
    file: `${w.He} took ${w.his} time`, `${w.v('keeps')}`. */
export interface Words extends Forms {
  He: string;
  he: string;
  Him: string;
  him: string;
  His: string;
  his: string;
  himself: string;
  v(verb: string): string;
}

export function words(p: Pronoun): Words {
  const f = FORMS[p];
  return {
    ...f,
    He: cap(f.subject), he: f.subject,
    Him: cap(f.object), him: f.object,
    His: cap(f.possessive), his: f.possessive,
    himself: f.reflexive,
    v: (verb) => conjugate(verb, f.plural),
  };
}
