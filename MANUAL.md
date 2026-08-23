# Manual

Install and run: [README](README.md). This is how you play, tune, and find your files.

`./run.sh` prints an address. Open that — a page of tiles, one per game.

Four buttons on the right of every page: sound, phone, hide the UI, console.
Type `/` in the console for commands. The version is in the top right of that
bar — quote it when something is wrong.

---

## Your phone

Skip this at the Mac. The phone is a remote: playback, room, typing work over
wifi already. The mic does not, until there is a certificate.

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

`lucid_talk/personas/` and `lucid_talk/prompts/` are the app. Yours is
`userdata/`, not in git:

```
userdata/
  config.json           certificate, phone, the shared model stack
  certs/                TLS keys from tools/phone.sh
  players/
    player1/            you, until --user
      log/
      lucid-talk/
        config.json     this game's tunables
        sessions/       one file per conversation
        memory/         what each persona knows, and where you stand
        rooms/          what a conversation did to its room
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

  "llm": {
    // Bare path = from the checkout. / or ~ = as given (other disk, shared pile).
    "model": "models/llm",
    "port": 6968,                   // a server found here is used as-is — keep it yours
    "venv": ".venv/bin",
    "temperature": 0.8,
    "max_tokens": 1400,             // fuse, not a target
    "context_turns": 6,
    "context_words": 600            // raising these is the slowest replies
  },

  "stt": { "model": "models/parakeet-tdt-0.6b-v2" },

  "tts": {
    "model": "models/Chatterbox-Turbo-fp16",  // or Chatterbox-fp16 for the two below
    "exaggeration": 0.6,            // ┐ full Chatterbox only
    "cfg_weight": 0.2,              // ┘ Turbo ignores these
    "pause": 0.0,
    "paragraph_pause": 0.45
  },

  "vad": {
    "floor_mult": 3.0,              // speech vs room noise — starting to talk
    "sustain_mult": 1.4,            // …and the lower bar for still talking
    "hangover_ms": 700,             // silence before you have stopped
    "min_turn_ms": 500,             // shorter is a cough
    "max_turn_ms": 30000,
    "barge_mult": 6.0,              // talk over the voice
    "barge_grace_ms": 600,
    "barge_learn_ms": 1500          // echo canceller settle
  },

  "mic_follows_window": "hidden"    // "hidden" | "focus" | "never"
}
```

Up the VAD numbers if it cuts you off; down if it waits after you finish.
`/mic_follow` changes the last one without a restart.

---

## Lucid Talk

Take a pill. The address bar will follow; bookmark it if you want that room
again. One conversation at a time: a second tab is the same stack.

Type, or turn the mic on. First reply of a session waits for the models.
`/ai_models_stop` unloads them. Mic is off until you press it; typing always
works. `"hidden"` keeps it while the page is there; `"focus"` dies when you
click the menu bar; `"never"` is the button only.

Talk over it and it stops mid-sentence.

Without **Play**, it answers once per thing you do (touch, talk, or type).
**Play** starts the tape: the pill keeps going on its own for the dose
(15 minutes default). What you say steers. **Pause** holds the sound; **Stop**
ends the run. **Skip** drops this line and, if the tape is running, goes on.

Hover a message: speaker replays, bin deletes (yours and the pill's, on disk).

### Personas

```
lucid_talk/personas/nova/
  persona.md      character + frontmatter
  voice.ref.wav   six seconds of speech
  room.js
  room.css
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
pause: 0.0
exaggeration: 0.6        # ┐ full Chatterbox only
cfg_weight: 0.2          # ┘
---
You are Nova. You are dry, curious, and you never pad an answer.
```

`place` is a first line; say you moved and the scene follows. **lover** and
**thinker** are offered; **companion** and **blunt** have `draft: true` until
they have voices. Edit, drop the flag, or add a directory. Re-read before every
reply, including `lucid_talk/prompts/`.

Turbo is the default and ignores `exaggeration` / `cfg_weight`. Full Chatterbox:
download `mlx-community/chatterbox-fp16` ([AGENTS.md](AGENTS.md)), point
`tts.model` at it. Same clips.

### Voices

A voice is `lucid_talk/personas/<name>/voice.ref.wav`. Nothing else wires it.

```sh
python tools/voiceprep.py some-recording.mp3 nova
```

The clip is the setting. Calm six seconds → a flat companion.
**[tools/VOICES.md](tools/VOICES.md)** is the rest.

### Memory and standing

`userdata/players/<you>/lucid-talk/memory/<persona>.md` — rewritten, not
appended. Last few turns go to the model; older ones fold into about eight
facts. **Memory** on the page to read or edit. *"I never had a dog"* removes
the dog.

`memory/<persona>.relation.json` is warmth, trust, mood. Not shown as numbers:
the room (lamp, weather, palette) moves with it. Delete the file to start over.
**History** reopens `lucid-talk/sessions/`.

### Tuning

The stack is in the machine config above. This game's file, read at session
start. Defaults and reasons: `lucid_talk/config.py`.

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
  "ui": {
    "continuous_minutes": 15        // how long Play runs the tape
  },
  "warm_on_open": true,             // load, and pre-chew the prompt, on entering a room
  "idle_stop_minutes": 30,          // quiet → unload models
  "resume_within_minutes": 5        // back inside this = same conversation
}
```

JSON on disk has no comments. Type `/` in the console for what you can change
live.
