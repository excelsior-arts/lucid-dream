import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/* Which way an import may point.
 *
 * talk → shell, world, audio, machine, ui. ui → shell.
 * machine → shell, audio. audio → shell.
 * shell → nothing of ours. world → nothing of ours.
 * That is the whole architecture of this workspace, and a wrong edge is not
 * visible in a diff — it compiles, it runs, and the shell has quietly learned
 * what a pill is. So it is a lint error instead.
 *
 * Reached by name and never by path: `../../talk/src/manifest` resolves
 * perfectly well and goes around every rule below, so climbing out of a
 * package is refused everywhere. Both shapes it can take: from the workspace
 * root, and from inside a package -- where the giveaway is the `src/` of the
 * package next door, since inside one there is no such directory to name. */
const OUT_OF_PACKAGE = {
  group: ['**/packages/**', '**/src/**'],
  message: 'a package is reached by its name (@lucid/shell), not by climbing out of one',
};
const inward = (patterns) => ({
  'no-restricted-imports': ['error', {patterns: [...patterns, OUT_OF_PACKAGE]}],
});

/* Every game on the shelf. A game imports the five framework packages and no
   game at all -- not its neighbour, and not itself by name, which is the same
   module graph reached twice. What one game knows about another is that it
   exists, and it learns even that from app/src/main.tsx.

   A list, because flat config has no way to say "a package that is not one of
   the framework five". A second game is a line here, which is the same line it
   already is in main.tsx. */
const GAMES = ['talk'];

// Small on purpose. The point of lint here is a red/green an agent can run,
// not a house style -- the code is hand-set and stays so, TypeScript owns
// what is true, and this is left with the two or three things neither sees.
export default tseslint.config(
  {ignores: ['dist', 'node_modules', 'playwright-report', 'test-results']},
  tseslint.configs.recommended,
  reactHooks.configs.flat['recommended-latest'],
  {
    plugins: {'react-refresh': reactRefresh},
    rules: {
      'react-refresh/only-export-components': ['warn', {allowConstantExport: true}],
      // Tests used to read seventy script-scope globals; a bundler renames all
      // of them. debug.ts is the one door, so the wall has to be a rule.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'AssignmentExpression > MemberExpression.left[object.name="window"]',
          message: 'nothing goes on window; expose() it through packages/shell/src/debug.ts',
        },
      ],
      ...inward([]),
    },
  },
  {files: ['packages/shell/src/debug.ts'], rules: {'no-restricted-syntax': 'off'}},
  {
    files: ['packages/shell/**'],
    rules: inward([
      {
        group: ['@lucid/talk', '@lucid/talk/*'],
        message: 'the shell must not know a game exists: take it as a manifest prop instead',
      },
      {
        group: ['@lucid/audio', '@lucid/audio/*', '@lucid/ui', '@lucid/ui/*',
                '@lucid/machine', '@lucid/machine/*', '@lucid/world', '@lucid/world/*'],
        message: 'the shell is what audio, machine, ui and world are built on, '
          + 'not the other way about',
      },
    ]),
  },
  /* The mechanics every game reuses: an open box, a transport deck, a sheet,
     a transcript, and a stage. It reaches the shell -- the sound, the fit, the
     console are the whole page's -- and nothing else of ours. Not a world: a
     stage is handed the way to build a scene and never builds one, which is
     what stopped it importing a game's idea of a room by name. Not audio: a
     meter is two numbers, and which two is the game's to hand in. And
     certainly not a game: a card knows its color and not what taking it
     means. */
  {
    files: ['packages/ui/**'],
    rules: inward([
      {
        group: ['@lucid/talk', '@lucid/talk/*'],
        message: 'ui is what a game is built out of: take it as a prop instead',
      },
      {
        group: ['@lucid/audio', '@lucid/audio/*', '@lucid/machine', '@lucid/machine/*',
                '@lucid/world', '@lucid/world/*'],
        message: 'a mechanic takes numbers and callbacks, not a microphone, '
          + 'a model or a scene',
      },
    ]),
  },
  /* The device side of sound: a microphone, a speaker, a detector, and no
     idea what is being said into any of them. It reaches the shell -- the
     volume knob and the hush are the whole page's, and so is the address the
     machine answers on -- and nothing else of ours: what a game wants done
     when a voice stops arrives as a callback it hands in. */
  {
    files: ['packages/audio/**'],
    rules: inward([
      {
        group: ['@lucid/talk', '@lucid/talk/*', '@lucid/world', '@lucid/world/*',
                '@lucid/ui', '@lucid/ui/*', '@lucid/machine', '@lucid/machine/*'],
        message: 'audio knows nothing of a game, a world, an interface or a model: '
          + 'take it as a callback instead',
      },
    ]),
  },
  /* The model side: words asked for and streamed back, sentences spoken, and
     the several gigabytes behind both. It reaches the shell -- the address the
     machine answers on is the whole page's -- and audio, because a reply has
     to put its frames into the queue that plays them and pace its words
     against the voice. It reaches no game: what a persona is, what a memory
     of you is, and which of them is speaking arrive as messages and a name. */
  {
    files: ['packages/machine/**'],
    rules: inward([
      {
        group: ['@lucid/talk', '@lucid/talk/*', '@lucid/world', '@lucid/world/*',
                '@lucid/ui', '@lucid/ui/*'],
        message: 'the machine knows nothing of a game, a world or an interface: '
          + 'it is handed messages and a voice by name',
      },
    ]),
  },
  /* three.js and Rapier, wired together, and no idea what is being simulated.
     A world is the bottom of the stack: it is what a game with things in it
     that fall is built out of, and it imports nothing of ours at all -- not
     even the shell, because a physics step has no console to talk to. */
  {
    files: ['packages/world/**'],
    rules: inward([{group: ['@lucid/*'], message: 'the world imports nothing of ours'}]),
  },
  /* And a game reaches no game. Two games on one shelf share the framework and
     nothing else: whatever one of them has that the other wants is either the
     framework's already or is about to be. */
  ...GAMES.map((game) => ({
    files: [`packages/${game}/**`],
    rules: inward([
      {
        group: GAMES.flatMap((g) => [`@lucid/${g}`, `@lucid/${g}/*`]),
        message: 'a game imports the framework and no game: what two of them '
          + 'share belongs in the framework, and who is installed is '
          + 'app/src/main.tsx',
      },
    ]),
  })),
  /* The room and the rooms in it are hand-set JavaScript, moved rather than
     rewritten, and the two rules below are house style rather than truth:
     `void el.offsetWidth` to force a reflow and `fn && fn()` as a guard are
     both deliberate there, and a texture built for a wall that turned out not
     to need one is a comment about the room. Everything else still applies,
     and nothing here reaches a .ts file. */
  {
    files: ['packages/talk/src/room/**/*.js', 'packages/talk/src/rooms/*.js'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
);
