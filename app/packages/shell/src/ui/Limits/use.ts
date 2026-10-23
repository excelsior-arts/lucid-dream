/* The two questions a drawn part asks of the list of limits, kept current:
   whether this one holds here and now, and whether this is a browser at all.
   See shell/limits.ts. */
import {useSyncExternalStore} from 'react';
import {inBrowser, limited, limitsVersion, onLimits} from '../../shell/limits';
import type {Limit} from '../../shell/limits';

/** The limit, if it holds here and now, kept current: null on the machine. */
export function useLimited(id: string): Limit | null {
  useSyncExternalStore(onLimits, limitsVersion, limitsVersion);
  return limited(id);
}

/** Whether this page is the browser's own, kept current. */
export function useInBrowser(): boolean {
  useSyncExternalStore(onLimits, limitsVersion, limitsVersion);
  return inBrowser();
}

