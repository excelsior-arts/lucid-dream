/* Where this build lives on its host, for an address the router does not see.
 *
 * The machine serves the page at the root of its own origin; a static host may
 * serve it under a path of its own -- a GitHub Pages project site is
 * /<repository>/ -- and the build is told which (`LUCID_BASE`, see
 * vite.config.ts). The router is handed it as its basename, so a route never
 * says it; what does is a plain <a href> the browser reads before any
 * click handler, which is what a middle click or "copy link" takes. */

/** The build's base without its last slash: '' at the root, '/lucid-dream' under one. */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/** A document address under the base: `href('/talk')` is /lucid-dream/talk there. */
export const href = (path: string): string => BASE + path;

/** And the other way: a pathname as the router sees it, with the base taken off. */
export const routed = (pathname: string): string =>
  BASE && pathname.startsWith(BASE) ? pathname.slice(BASE.length) || '/' : pathname;
