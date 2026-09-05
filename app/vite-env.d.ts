/// <reference types="vite/client" />

/* At the workspace root, and not in the package that reads it, because three
   programs type-check the same source: the shell's own, the game's (which
   compiles the shell's files it imports), and the composed app's. A global
   augmentation has to be in all three or it is in none of them. */
interface ImportMetaEnv {
  // Where the websockets live when the page was not served by the backend --
  // Electron, later. Empty everywhere else. See shell/backend.ts.
  readonly VITE_BACKEND?: string;
}
