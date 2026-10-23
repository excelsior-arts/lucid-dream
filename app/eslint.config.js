import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/* Which way an import may point.
 *
 * talk → shell, world, audio, machine, ui. trip → shell, machine, ui. ui → shell.
 * machine → shell, audio. audio → shell.
 * shell → nothing of ours. world → nothing of ours. trip's trips → world only.
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
/* The same wall for `import()`. no-restricted-imports only sees the static
   kind, and a dynamic import of a neighbour's content resolves just as well
   -- so each pattern is turned into a selector over the import expression's
   string, and the two rules say the same thing. A glob of ours is a package
   name and maybe a `/*`; a regex pattern is used as it is. */
const asRegex = (p) => {
  if (p.regex) return p.regex.replace(/\//g, '\\/');
  return '^(' + p.group.map((g) => {
    if (g.startsWith('**/')) return '.*' + g.slice(3).replace(/\*\*/g, '.*').replace(/\//g, '\\/');
    return g.replace(/\//g, '\\/').replace(/\*/g, '.*') + '$';
  }).join('|') + ')';
};
const dynamic = (patterns) => patterns.map((p) => ({
  selector: `ImportExpression > Literal[value=/${asRegex(p)}/]`,
  message: p.message,
}));
const inward = (patterns) => ({
  'no-restricted-imports': ['error', {patterns: [...patterns, OUT_OF_PACKAGE]}],
  'no-restricted-syntax': ['error', ON_WINDOW, ...dynamic([...patterns, OUT_OF_PACKAGE])],
});

// Tests used to read seventy script-scope globals; a bundler renames all
// of them. debug.ts is the one door, so the wall has to be a rule.
const ON_WINDOW = {
  selector: 'AssignmentExpression > MemberExpression.left[object.name="window"]',
  message: 'nothing goes on window; expose() it through packages/shell/src/debug.ts',
};

/* Every game on the shelf. A game imports the five framework packages and,
   of another game, only its mechanism -- never itself by name, which is the
   same module graph reached twice, and never a neighbour's content. What one
   game knows about another is that it exists, and it learns even that from
   app/src/main.tsx.

   A list, because flat config has no way to say "a package that is not one of
   the framework five". A second game is a line here, which is the same line it
   already is in main.tsx. */
const GAMES = ['talk', 'trip'];

/* What a game may take from another game: its mechanism, named module by
   module, and nothing else.

   Lucid Talk is a game and it is also the talking -- the name says both. What
   makes a character a character there (a standing that fades, a memory that
   folds, the shape of a dose) is what any game with somebody in it needs, and
   writing it twice would be the mistake this list exists to avoid. So a second
   game imports these by subpath and builds its own assembly on them. The
   rest of that folder is Talk's assembly: it writes into Talk's store and reads
   Talk's files, and importing it would be a second game running the first
   game's evening. The pills, the rooms, the routes and the prompts are content,
   and content stays behind the wall. */
const MECHANISM = {
  talk: ['character', 'arc', 'memory', 'relation', 'scene', 'prompt', 'hands', 'named', 'pronouns', 'files',
         'surface', 'room', 'turn', 'loop', 'floor', 'after']
    .map((m) => `conversation/${m}`),
};

/* And how every game bans every game. As a regular expression rather than a
   glob list, because the globs are gitignore's: a name banned as a directory
   cannot have one file under it let back in, and the whole point here is one
   folder with a few files let back in. The whole of a neighbour but its
   mechanism; the whole of itself, with no exceptions. */
const gameImports = (self) => GAMES.map((g) => ({
  regex: g === self || !(MECHANISM[g] ?? []).length
    ? `^@lucid/${g}(/|$)`
    : `^@lucid/${g}(?!/(${MECHANISM[g].join('|')})$)(/|$)`,
  message: 'a game imports the framework and, of another game, only the '
    + 'mechanism named in MECHANISM: what two of them share beyond that '
    + 'belongs in the framework, and who is installed is app/src/main.tsx',
}));

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
      ...inward([]),
    },
  },
  {
    files: ['packages/shell/**'],
    rules: inward([
      {
        group: ['@lucid/talk', '@lucid/talk/*', '@lucid/trip', '@lucid/trip/*'],
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
        group: ['@lucid/talk', '@lucid/talk/*', '@lucid/trip', '@lucid/trip/*'],
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
        group: ['@lucid/talk', '@lucid/talk/*', '@lucid/trip', '@lucid/trip/*',
                '@lucid/world', '@lucid/world/*',
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
        group: ['@lucid/talk', '@lucid/talk/*', '@lucid/trip', '@lucid/trip/*',
                '@lucid/world', '@lucid/world/*',
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
  /* The trips themselves: Burning Man is the first, under trips/burning-man.
     A trip stands on the world -- the desert, its sand and sea and sky, the
     camera, the keys, the loop and the sound are @lucid/world's -- and on
     nothing else of ours: the route that opens it hands it an element, and
     that is the whole of what it knows about the house. Its trip.ts -- the
     card and the door -- is the one file of a trip the box reads. */
  {
    files: ['packages/trip/src/trips/**'],
    rules: inward([{group: ['@lucid/*', '!@lucid/world', '!@lucid/world/*'],
                    message: 'a trip stands on @lucid/world and imports nothing else of ours: it is opened by the route and knows nothing of a shell or a box'}]),
  },
  /* And a game reaches another game's mechanism, never its content. Two games
     on one shelf share the framework and the mechanism listed above: whatever
     else one of them has that the other wants is either the framework's
     already or is about to be. */
  ...GAMES.map((game) => ({
    files: [`packages/${game}/**`],
    rules: inward(gameImports(game)),
  })),
  /* The one door onto window, after the shell's own wall so that it is the
     last word. */
  {files: ['packages/shell/src/debug.ts'], rules: {'no-restricted-syntax': 'off'}},
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
