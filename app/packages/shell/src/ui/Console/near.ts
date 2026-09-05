/* Matched on any word of the name, not only the first.

   The names read subject first — lamp_dim, ai_models_start — which is what
   makes the list sort into families when you read it down. It also puts the
   verb last, and the verb is what somebody types: they want to start something
   and type "start", which under a prefix match found nothing at all and looked
   like the command did not exist.

   Whole-name matches still come first, so typing the beginning of a name gets
   that name at the top rather than buried among its relatives. */
import type {Order} from '../../shell/console';

export function near(typed: string, all: Order[]): Order[] {
  if (!typed.startsWith('/')) return [];
  const want = typed.slice(1).split(' ')[0]!.toLowerCase();
  const score = (name: string) => {
    const n = name.toLowerCase();
    if (n.startsWith(want)) return 0;
    return n.split('_').some(part => part.startsWith(want)) ? 1 : -1;
  };
  return all.map(o => [score(o.name), o] as const)
            .filter(([n]) => n >= 0)
            .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name))
            .map(([, o]) => o);
}
