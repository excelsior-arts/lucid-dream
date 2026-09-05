# Manual

Install and run: [README](README.md). This is how you play, tune, and find your files.

`./run.sh` prints an address. Open that — a page of tiles, one per game.

Four buttons on the right of every page: sound, phone, a crossed-out eye
(nothing leaves this machine — press it and it says so), console.
Type `/` in the console for commands. The version is in the top right of that
bar — quote it when something is wrong.

---

## Your phone

Skip this at the Mac. The phone is not a remote — it is the same page, running
its own conversation. Room, typing and playback work over wifi already. The mic
does not, until there is a certificate.

```sh
./tools/phone.sh
```

Then on the phone:

1. AirDrop (or mail) the file it names at the end.
2. Open it → **Settings** → *Profile Downloaded* → install.
3. **Settings → General → About → Certificate Trust Settings** — turn on
   `mkcert`. This is the step that is silent if you miss it.

`./run.sh` then prints an `https://` address. Open that on the phone.

**Trap:** the Mac now has two addresses. Open **localhost** on the Mac. The
phone's address opened *on the Mac* looks fine and has no microphone. If Talk
fails, the line the page prints is why.

Anyone on the wifi who finds the port can read conversations and start the
models. Trusted networks only.

---

## Your files

`app/packages/talk/` is the game — its characters and its prompts under
`content/`, and what it ships tuned to in its manifest. Yours is `userdata/`,
not in git:

```
userdata/
  config.json           certificate, phone, the shared model stack
  certs/                TLS keys from tools/phone.sh
  players/
    player1/            you, until --user
      log/
      lucid-talk/     one directory per game, laid out as it names its paths
        config.json   this game's tunables, where you differ from it
        memory/       what each persona knows, and where you stand
        rooms/        what a conversation did to its room
        sessions/     one file per conversation
      tmp/
    pete/
```

Delete `players/<you>/` to start as a stranger. Copy that directory to move
yourself.

---

## The machine's settings

`userdata/config.json` — one language model, one recognizer, one voice, one
mic, shared by every game. Two copies would not fit in memory.

```jsonc
// userdata/config.json
{
  "phone": true,
  "tls_cert": "userdata/certs/lucid.pem",
  "tls_key": "userdata/certs/lucid-key.pem",

  // Where the models are: a shelf of checkouts, models/<org>/<repo>, beside
  // the code. Which repository plays which part is machine/models.json, so
  // nothing here names a model. Bare path = from the checkout; / or ~ = as
  // given (other disk, shared pile).
  "models": { "dir": "models" },

  "llm": {
    "size": "lg",                   // sm, md or lg — setup picks by memory, the console switches
    "port": 6968,                   // a server found here is used as-is — keep it yours
    "venv": ".venv/bin",
    "temperature": 0.8,
    "max_tokens": 1400,             // fuse, not a target
    "sizes": {}                     // sizes of your own, name to path, beside the three
  },

  "stt": {},                        // "model": a path, for a recognizer of your own

  "tts": {
    // "model": a path, for Chatterbox-fp16 if you want the two below to do anything
    "exaggeration": 0.6,            // ┐ full Chatterbox only
    "cfg_weight": 0.2,              // ┘ Turbo ignores these
    "pause": 0.0,
    "paragraph_pause": 0.45
  },

  "voices": {},                     // "path": the shelf of reference clips, default models/voices

  "vad": {
    "floor_mult": 3.0,              // speech vs room noise — starting to talk
    "sustain_mult": 1.4,            // …and the lower bar for still talking
    "hangover_ms": 700,             // silence before you have stopped
    "min_turn_ms": 500,             // shorter is a cough
    "max_turn_ms": 30000,
    "barge_mult": 6.0,              // talk over the voice
    "barge_grace_ms": 600,
    "barge_learn_ms": 1500,         // echo canceller settle
    "barge_voiced": 0.30            // a voice, rather than a door closing
  },

  "mic_follows_window": "hidden",   // "hidden" | "focus" | "never"
  "mic_barge": "auto"               // "auto" | "on" | "off"
}
```

Up the VAD numbers if it cuts you off; down if it waits after you finish. The
page does the listening and reads these when a room opens, so a change takes
a reload rather than a restart. `/mic_follow` and `/mic_barge` change the last
two live: `auto` leaves talking over the pill to what the browser's echo
cancellation actually is, and `on` insists where a browser reports what it
does not do.

---

## Lucid Talk

Take a pill. The address bar will follow; bookmark it if you want that room
again. Every page is its own conversation — a second tab, or the phone, runs
its own loop with its own microphone. What they share is the machine: one
language model and one voice, so two turns at once queue rather than collide.
Two tabs on the *same* pill inside `resume_within_minutes` do resume the same
session, and neither of them is told; take a different pill, or wait it out.

Type, or turn the mic on. First reply of a session waits for the models.
`/ai_models_stop` unloads them. Mic is off until you press it; typing always
works. `"hidden"` keeps it while the page is there; `"focus"` dies when you
click the menu bar; `"never"` is the button only.

**What is loaded, and when.** Taking a pill starts the language model and
nothing else. The recognizer is loaded the first time you press **Talk** — the
key says it is warming until it is up, and arms then — so a player who only
ever types never pays for it. The voice is loaded by the first reply that is
spoken; mute everything (the speaker in the rail) and none is: the reply
arrives as text, at a reading pace, with no voice made for it. Turn either off
— the mic, or the sound — and what it was holding is given back a minute and a
half later, unless you change your mind in between. Unmuting takes effect from
the next reply.

Talk over it and it stops mid-sentence.

Without **Play**, it answers once per thing you do (touch, talk, or type).
**Play** starts the tape: the pill keeps going on its own for the dose
(15 minutes default). What you say steers. **Pause** holds the sound; **Stop**
ends the run. **Skip** drops this line and, if the tape is running, goes on.

Hover a message: speaker replays, bin deletes (yours and the pill's, on disk).

### Personas

```
app/packages/talk/content/personas/nova/persona.md   character + frontmatter
models/voices/nova.wav                               six seconds of speech
```

```markdown
---
name: Nova
pill: Purple
blurb: Dry, curious, and never pads an answer.
color: "196, 132, 252"
figure: diamond
place: |
  A room at night. One lamp, a window with rain on it, a low couch.
temperature: 0.85
max_tokens: 200          # fuse, not a target — ask for length in the body
---
You are Nova. You are dry, curious, and you never pad an answer.
```

`place` is a first line; say you moved and the scene follows. **lover** and
**thinker** are offered; **companion** and **blunt** have `draft: true` until
they have voices. Edit, drop the flag, or add a directory — and rebuild
(`cd app && npm run build`), because the characters and the prompts beside them
in `content/prompts/` travel in the bundle.

The room a character puts you in is not in its directory: it is game code, at
`app/packages/talk/src/rooms/nova.js` with a `.css` beside it, and editing one
means rebuilding the page (`cd app && npm run build`). A character without one gets
the default room, which is what `app/packages/talk/src/room/` draws when it is
handed nothing.

Turbo is the default and ignores `exaggeration` / `cfg_weight`. Full Chatterbox:
download `mlx-community/chatterbox-fp16` ([AGENTS.md](AGENTS.md)), point
`tts.model` at it. Same clips.

### Your own

The characters above ship with the game and are never edited in play. What you
change is yours, kept in your own directory beside what each pill remembers of
you, and layered over the shipped words when a reply is assembled:

```
userdata/players/<you>/lucid-talk/personas/lover/prompt.md       your words
userdata/players/<you>/lucid-talk/personas/lover/tunables.json   your settings
```

In a room, from the console: `/persona_show` says which parts are yours and how
the character is set — never the words themselves, which the console does not
carry. `/persona_set` opens the character in a sheet; edit, Save, and the next
turn is in your words. Saving an empty page puts the shipped ones back.
`/persona_tune temperature 0.4`, or `/persona_tune voice thinker` — a name on
the shelf, checked before it is written; `/persona_tune` alone lists what there
is. `/persona_reset` asks, then deletes both files.

Nothing else about a pill is yours to change here: its name, its colour, the
figure on its card and the room it opens in are what the box is drawn from, and
they stay the game's. No rebuild — these are read when a room opens.

### Voices

A voice is `<voices.path>/<name>.wav`, beside the weights — a clip is a model
asset, not a game's, and `--models DIR` moves the shelf with them. A character speaks in the one with its own name unless its
frontmatter says `voice: <other>`; nothing else wires it. `GET /machine/voices`
and `./setup.sh --check` both list what is there, and a character naming one
that is not says so in the console as the room opens.

```sh
python tools/voiceprep.py some-recording.mp3 nova
```

The clip is the setting. Calm six seconds → a flat companion.
**[tools/VOICES.md](tools/VOICES.md)** is the rest.

`pause`, `exaggeration` and `cfg_weight` are accepted in the frontmatter and in
`/persona_tune`, and go no further: the request that speaks a line carries the
text, the voice and whether the paragraph ended, and nothing else. Delivery is
the machine's, in the `tts` block above, for every character at once. The
console says so when you set one.

### Memory and standing

`userdata/players/<you>/lucid-talk/memory/<persona>.md` — rewritten, not
appended. Last few turns go to the model; older ones fold into about eight
facts. `/memory_show` in a room, or the **memories** count under a pill's lid
in the box, opens it to read or edit. *"I never had a dog"* removes the dog.

`memory/<persona>.relation.json` is warmth, trust, mood. Not shown as numbers:
the room (lamp, weather, palette) moves with it. Delete the file to start over.
`/sessions_list` in a room, or the **doses** count under a pill's lid in the
box, reopens `lucid-talk/sessions/`.

### Tuning

The stack is in the machine config above. This game's file, read when a room
opens, holds only what you have changed. What it ships with, and why each
number is what it is: `app/packages/talk/src/manifest.ts`.

```jsonc
// userdata/players/<you>/lucid-talk/config.json
{
  "memory": {
    "enabled": true,
    "max_bullets": 8,
    "fold_after": 4
  },
  "relation": { "enabled": true, "score": true },
  "scene":    { "enabled": true, "every_words": 300 },
  "llm": {
    "context_turns": 6,             // how many exchanges go up with a turn
    "context_words": 600,           // raising these is the slowest replies
    "temperature": 0.8,             // a character's own frontmatter beats this
    "top_p": 0.95
  },
  "ui": {
    "continuous_minutes": 15        // how long Play runs the tape
  },
  "resume_within_minutes": 5        // back inside this = same conversation
}
```

JSON on disk has no comments. Type `/` in the console for what you can change
live.
