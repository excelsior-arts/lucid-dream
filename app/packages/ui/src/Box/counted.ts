/* A number and the thing it counts, the way a lid's tally says it: "1 dose",
 * "2 doses". The noun is the game's -- nothing here knows what is counted --
 * and the rule is one for every box on the shelf, so two lids never disagree
 * about whether one of something is plural. What a box says for none is its
 * own ("never taken", "no doses") and is not asked here.
 */
export const counted = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;
