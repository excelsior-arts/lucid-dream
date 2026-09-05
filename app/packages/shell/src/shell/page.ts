import {useLayoutEffect} from 'react';

/* Which page this is, written onto <html> so a route's stylesheet applies
   only while that route is on screen.

   One hook for every route, and a layout effect rather than a plain one, for
   a reason that only shows when moving between routes: React runs the
   leaving route's passive cleanup after the arriving route's layout effect.
   With the box clearing the attribute in a passive effect and the room
   setting it in a layout one, the room set its name and the box then deleted
   it — leaving a room with no stylesheet, its glass and deck laid out as
   plain blocks under the stage, and a page that only a reload could fix.
   Layout effects and their cleanups run in one phase, leaving before
   arriving, so the order is right. The cleanup still checks the name is its
   own before removing it: whichever way the phases fall, a route never
   undoes what the next one wrote. */
export function usePage(name: string): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.page = name;
    return () => {
      if (root.dataset.page === name) delete root.dataset.page;
    };
  }, [name]);
}
