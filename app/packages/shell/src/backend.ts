// One address, not location.host, because a packaged app will point at a
// sidecar Python on a port the page was never served from. In the browser the
// backend is wherever the page came from -- through the dev proxy that is
// Vite, in production it is the server itself.
export function backend(): string {
  const set = import.meta.env.VITE_BACKEND;
  if (set) return set;
  return location.origin.replace(/^http/, 'ws');
}
