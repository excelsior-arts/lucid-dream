/// <reference types="vite/client" />

/* At the workspace root, and not in the package that reads it, because three
   programs type-check the same source: the shell's own, the game's (which
   compiles the shell's files it imports), and the composed app's. A global
   augmentation has to be in all three or it is in none of them. */
interface ImportMetaEnv {
  // Where the websockets live when the page was not served by the backend --
  // Electron, later. Empty everywhere else. See shell/backend.ts.
  readonly VITE_BACKEND?: string;
  // A build for a static host (LUCID_BASE set; see vite.config.ts): there is
  // no machine to ask for. False in the machine's own build and in tests.
  readonly LUCID_STATIC?: boolean;
}

/* The little of @soprotts/onnx-web 0.3.0 that the browser's voice uses
   (packages/machine/src/page/voice-worker.ts). The package ships JavaScript
   with no types, and an ambient module has to be seen by every program that
   compiles the worker -- which is why it is here. */
declare module '@soprotts/onnx-web' {
  export interface SoproReference {
    readonly __sopro?: never;
  }
  export interface SoproProgress {
    url?: string;
    file?: string;
    loaded?: number;
    total?: number;
  }
  export class SoproTTS {
    static create(o?: {
      model?: string; revision?: string; backend?: 'auto' | 'webgpu' | 'wasm';
      onProgress?: (p: SoproProgress) => void;
    }): Promise<SoproTTS>;
    /** Every graph's weights, fetched and cached; otherwise they come on first use. */
    preload(onProgress?: (p: SoproProgress) => void): Promise<void>;
    prepareReference(file: Blob | Float32Array, o?: {sampleRate?: number}): Promise<SoproReference>;
    synthesize(text: string, reference: SoproReference, o?: {language?: string}): Promise<Float32Array>;
    dispose(): Promise<void>;
  }
}
