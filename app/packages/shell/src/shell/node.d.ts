/* Node, only as much of it as one test needs.

   Reading a file off disk is something a test does and the app never does, so
   node's types stay out of `types` in tsconfig.app.json — turning them on
   there would put `process` and `Buffer` in front of every browser module and
   make writing one into the bundle a thing TypeScript agrees with. The QR test
   has to load the encoder this port replaced, from the checkout, so the three
   calls that takes are declared here and nowhere else. */
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
declare module 'node:path' {
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
}
declare const process: {cwd(): string};
