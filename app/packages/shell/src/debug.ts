// The only thing on window, and the only thing a browser test may reach for.
// A bundler renames every script-scope name, so nothing a test could find by
// accident survives a build; what tests are allowed to see is put here on
// purpose, and nothing else is put on window at all.
declare global {
  interface Window {
    __lucid?: Record<string, unknown>;
  }
}

export function expose(name: string, value: unknown): void {
  const shelf = (window.__lucid ??= {});
  shelf[name] = value;
}
