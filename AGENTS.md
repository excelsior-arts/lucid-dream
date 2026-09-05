# Setting up Lucid Dream

One machine and the games that run on it. There is one game so far — Lucid
Talk, in `app/packages/talk/` — and everything below is what it needs.

Instructions for a coding agent (or a person who likes a checklist). The goal
is a working `./run.sh` with the models on disk and `userdata/config.json`
pointing at them.

**Requirements:** Apple Silicon Mac, macOS 14+, Python 3.12, Node 24 with npm,
~40 GB disk, and enough RAM for the size of language model in use — the
machine's own meter reports ~23 GB mid-reply on the large 27B 4-bit, ~12 on
the 9B, ~9 on the 4B, so 32 GB is the floor for the large one and 16 GB for
the middle; setup picks by memory. Verify before starting:

```sh
uname -m                                  # expect arm64
node --version                            # expect v24 or later
sysctl -n hw.memsize | awk '{print $1/1073741824 " GB"}'
df -h ~ | tail -1
```

---

## 1. Environment

Anything that gives Python 3.12 works; `uv` is fastest.

```sh
cd path/to/lucid-dream                    # wherever you cloned it
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt
```

`requirements.txt` is the list, and it ends with a commented block holding one
thing only used to check the work — `pillow`, which measures the icon set in
`tests/machine/test_icons.py` and cuts it in `tools/cut_icons.py`. Those tests
skip themselves when it is not installed, so the suite is green either way.

Known-good versions: mlx 0.32.2, mlx-audio 0.5.0, mlx-vlm 0.6.17, numpy 2.5.2,
scipy 1.18.1. `sentencepiece` is only needed because `mlx_audio.sts` imports
Moshi at package level; without it the speech-enhancement import fails.

Check it:

```sh
.venv/bin/python -c "import mlx.core as mx; print(mx.default_device())"   # Device(gpu, 0)
```

Then the page, which is an npm workspace of its own under `app/` — React,
three.js and a Vite build. Python serves what the build writes, so this is done
once before the first `./run.sh` and again whenever anything under
`app/packages` moves:

```sh
cd app && npm ci && npm run build
```

`./setup.sh` does both halves. Node is the one requirement here that is only
about the page: without it the server still runs, the models still load and
every address answers with a page saying what is missing and this command.

**The page is the microphone, and the only one.** It captures and streams 16 kHz
PCM to this process, which opens no audio device of its own — not for recording
and not for playing. That is the browser's permission prompt, and it needs HTTPS
(see step 5). A browser that is only playing never asks for anything; it asks the
moment you turn the mic on.

**On this computer, no certificate is needed at all.** `localhost` and
`127.0.0.1` are secure origins by the standard, so the microphone works over
plain http with nothing installed and nothing trusted. Measured, in a browser:

| address                | secure context | `getUserMedia` | microphone |
|------------------------|----------------|----------------|------------|
| `http://127.0.0.1:6969`| yes            | present        | granted    |
| `http://localhost:6969`| yes            | present        | granted    |
| `http://192.168.x.x`   | **no**         | **absent**     | not offered|

That last row is the whole reason certificates are here: a phone reaches this
Mac by its address on the wifi, which is not a secure origin, and on an
insecure origin `getUserMedia` does not exist to be called. There is no way
around it from this side — it is the browser's security model, not a setting.

So: **certificates are for the phone.** If you are only ever playing at the
computer you do not need them at all — leave `tls_cert`/`tls_key` unset and
open `http://localhost:6969`.

**With certificates on, one port still serves both, and the address decides.**
`localhost` is a trustworthy origin whatever the certificate says, so the
microphone works there without anything being installed or trusted. A wifi name
is not, and needs the certificate to verify.

| where you are | what to open                  | microphone |
|---------------|-------------------------------|------------|
| this Mac      | `https://localhost:6969`      | works      |
| this Mac      | `https://mac.local:6969`      | refused, silently |
| a phone       | `https://mac.local:6969`      | needs the CA trusted, below |

The middle row is the trap: it is the same machine, the same port and the same
room, and it is the address the phone uses — so it is the one you copy. There
is no warning, because the page loads perfectly; only the microphone is gone.

**Safari and iOS need the certificate to be *trusted*, not merely present.**
A browser will not hand a microphone to a page it does not trust, and Safari
enforces that where Firefox will let a manually-accepted exception through — so
a self-signed certificate looks fine, loads the page, plays the voice, and
refuses the microphone with `InvalidStateError`. For the phone, the certificate has to verify. Run this once:

```sh
mkcert -install          # puts the local CA in the System keychain; asks for sudo
security verify-cert -c userdata/certs/lucid.pem   # should say "certificate verify Result: OK"
```

On an iPhone, mail yourself `~/Library/Application Support/mkcert/rootCA.pem`,
install the profile, and then turn it on under **Settings → General → About →
Certificate Trust Settings**. Installing it is not enough; that last switch is
what Safari reads.

**Why it is a rule and not a preference.** A microphone has one holder: a device
taken by this process is a device the browser is then refused, and the page has
nowhere else to go. And the page both plays the pill's voice and captures the
room, which is what lets the browser subtract one from the other —
`echoCancellation: true`, the same AEC a video call runs. That is what makes
speakers usable: without it an open mic hears the pill, transcribes it, and
answers it. The console says what the microphone track actually granted — a
line reading `microphone: echo canceled`, or `microphone: no echo cancellation
— use headphones` — because asking for cancellation is not getting it
(`app/packages/audio/src/capture.ts`).

---

## 2. Models

Five checkouts into `models/` beside the code, plus a tokenizer that fetches
itself. None is gated and none needs a Hugging Face account — Apache-2.0 and
CC-BY-4.0, downloaded anonymously.

The rule of the shelf: every model is a checkout of a published repository at
`models/<org>/<repo>`, exactly as published, never changed. Which repository
plays which part is `machine/models.json` — the language model in three
sizes, the ear, the voice, each pinned to a commit — and that file is the only
thing a newer release edits to bring a newer model. `./setup.sh` reads it,
fetches what is missing or at another commit, and lists what nothing names any
more (`--prune` removes it). By hand, the same five:

```sh
DL='.venv/bin/python -c'

# 1. the language model — the personality, in three sizes. ~16, 6 and 3 GB.
# Step 3 writes whichever this Mac's memory is good for; the console switches.
$DL "from huggingface_hub import snapshot_download as d; d('mlx-community/Qwen3.8-27B-4bit', local_dir='models/mlx-community/Qwen3.8-27B-4bit')"
$DL "from huggingface_hub import snapshot_download as d; d('mlx-community/Qwen3.5-9B-MLX-4bit', local_dir='models/mlx-community/Qwen3.5-9B-MLX-4bit')"
$DL "from huggingface_hub import snapshot_download as d; d('mlx-community/Qwen3.5-4B-MLX-4bit', local_dir='models/mlx-community/Qwen3.5-4B-MLX-4bit')"

# 2. speech to text — Parakeet. ~2.5 GB.
$DL "from huggingface_hub import snapshot_download as d; d('mlx-community/parakeet-tdt-0.6b-v2', local_dir='models/mlx-community/parakeet-tdt-0.6b-v2')"

# 3. text to speech — Chatterbox Turbo, which clones a voice from a clip. ~3 GB.
$DL "from huggingface_hub import snapshot_download as d; d('mlx-community/chatterbox-turbo-fp16', local_dir='models/mlx-community/chatterbox-turbo-fp16')"
```

`models/` sits beside the code so the whole thing stays one directory you can
move or delete, and it is in `.gitignore`. To keep the shelf elsewhere — a disk
of its own, or a pile shared between checkouts — download there in the same
layout and write that directory as `models.dir` in step 3: a path starting
with `/` or `~` is taken as given, anything else is read from the checkout.

Chatterbox pulls a tokenizer (`mlx-community/S3TokenizerV2`, ~470 MB) into the
Hugging Face cache the first time it loads. That is expected, and after it the
app runs with no network at all.

**Turbo or full Chatterbox.** Turbo is the default: measured on the same line
and reference clip it produced a whole reply in 3.24s against 4.02s, with the
same speaking rate and a voice most listeners preferred. What it gives up is the
delivery controls — it ignores `exaggeration` and `cfg_weight`, so per-sentence
intensity does nothing there.

Swap to the full model if you want those knobs:

```sh
$DL "from huggingface_hub import snapshot_download as d; d('mlx-community/chatterbox-fp16', local_dir='models/Chatterbox-fp16')"
```

and point `tts.model` at it. The app detects which one is loaded from the path
and stops passing the arguments Turbo rejects. Both clone from the same clips,
so voices carry over untouched.

**Two servers, and the default is the fast one.** `llm.server` chooses which
program serves the model; both read the same files. `mlx_lm` keeps the prompts
it has already processed and re-uses the longest matching prefix, which matters
because the system prompt, persona, memory and relation come to ~800 words that
never change between turns. Measured on one machine, same model, same prompt,
time to first token: **3.4s every turn under `mlx_vlm`, 1.2s from the second
turn on under `mlx_lm`.** Switch to `mlx_vlm` if you ever point this at a
vision model — and note that under `mlx_lm` a thinking model must be told not
to think, which `models.py` does by sending `enable_thinking: false`; without
it the reply arrives as `reasoning` deltas and never reaches the page.

**On the language model.** Any MLX chat model works — it is spoken to over an
OpenAI-compatible endpoint. Bigger is better company and slower to answer;
decode speed is what makes a reply feel slow, and a 27B 4-bit model manages
roughly 13-16 tokens/s on an M-series laptop. It ships in three sizes, all
fetched by setup.sh, which writes the one the machine's memory is good for
and leaves the console (`ai_model_size`) to switch:

| RAM | setup writes | what it is |
|---|---|---|
| 32 GB+ | `lg` | the 27B 4-bit the game was written against; ~23 GB mid-reply with the voice and the ear |
| 16 GB | `md` | the 9B: under a second to the first word; uses memory, but the register narrows — jealous, one note; slips into stage directions in brackets and the third person now and then |
| 8 GB | `sm` | the 4B: runs, and loses the character — invents, repeats, narrates from outside. For proving the machine works, not for an evening |

Those judgements are from the replay in lab/ (September 2026), not from the
earlier note here about a 9B abliterated build, which did leak the room into
dialogue and lose the thread; the stock 9B of the current generation does not.
Refusal-stripped builds were tried and dropped: the stock 27B stayed in
character through the hardest sessions, and the stripped one wrote worse.

Quantisation is a memory/quality trade. 6-bit is noticeably better and ~6 GB
larger; on a 48 GB machine with a browser and an editor open it pushed this one
into swap, which is far worse than the quality gain.

---

## 3. Configure

There are two, at different levels (see `machine/paths.py`). The machine's
`userdata/config.json` holds the certificate, whether the wifi address is
offered, and **the stack every game shares**: the language model, the
recognizer, the voice, and the microphone's thresholds — one of each, however
many games are installed. A game's own
`userdata/players/<who>/<game>/config.json` — reached as
`/store/<game>/data/config.json` — holds only what is that game's, and only
where you differ from what it ships with; for Lucid Talk that
is what it remembers and how long a dose runs. The machine never opens it —
it is a value in the store, read and merged by the page that knows what the
keys mean. `<who>` is
`player1` unless `./run.sh --user` said otherwise. The port is in neither and
never is: `./run.sh --port`, 6969 by default, and nothing on disk remembers it.

Write the size and the environment in — no model paths, the manifest names
those, and a path written here is a path a newer release leaves stale:

```sh
.venv/bin/python - <<'PY'
import json, pathlib
p = pathlib.Path("userdata/config.json")
c = json.loads(p.read_text()) if p.exists() else {}
c.setdefault("llm", {}).update({"size": "lg", "venv": ".venv/bin"})   # sm, md or lg
# c["models"] = {"dir": "/Volumes/big/models"}   # only if the shelf is elsewhere
p.write_text(json.dumps(c, indent=2))
PY
```

Relative to the checkout, which is how any path not starting with `/` or `~` is
read — so the file survives the directory being moved and says the same thing
on every machine. Absolute still works, for models kept elsewhere.


`llm.venv` is the directory the machine launches the language model from, as a
child process. It needs `mlx_lm.server`, which is what `requirements.txt`
installs and what the machine runs; `mlx-vlm` is in the list as an alternative
server for models `mlx-lm` will not load, and nothing needs it to be there.

`run.sh` runs the server from that same directory — it reads `llm.venv`, falls
back to a `.venv` in the checkout, and there is nothing in the script to edit.

---

## 4. Verify

```sh
./run.sh
```

Expected output, then the page is reachable at the printed address:

```
lucid dream  ->  http://127.0.0.1:6969
```

That address is the shelf: a tile per game. Lucid Talk is at `/lucid-talk/`,
which opens a box of pills; taking one opens that pill's room at
`/lucid-talk/<name>`. All three are one document — the routing is the page's —
and `./run.sh` on its own serves the built one out of `app/dist`.

Working on the page, run both:

```sh
./run.sh                                  # the backend, on 6969
cd app && npm run dev                     # the page, on 5173
```

and open `http://127.0.0.1:5173`. Every address that belongs to Python — the
websockets, `/shared/where` — is proxied through to 6969, so it is one origin
to the browser and the same conversation either way, with the page rebuilt as
it is edited. Nothing is served out of `app/dist` there, so a build is not
needed until you want to see what a player sees.

Take a pill, then type a line or press **Talk** and say one. Nothing is started
by hand: the first thing you say loads what it needs. Open the console — the
last button in the right-hand rail — and watch. It says very little when it
works; one line goes by:

```
machine   starting the language model on :6968 …
```

and the row along the top of the console is where the rest of it is: three
lamps — `LLM`, `STT`, `TTS` — amber while each loads and lit when it is up,
with what the whole thing is holding beside them (`21.4 GB`).

It should answer in text and out loud a few seconds later; only the first reply
of a session waits for the models. `/ai_models_start` loads all three without
waiting to be asked for a turn, and `/ai_models_stop` unloads them and gives
the memory back — the lamps go out and the figure in that row drops.

Two of the three lamps are lit by the page rather than by a turn. `STT` comes
up when somebody presses **Talk** and not before — a player who types never
loads a recognizer — and `TTS` when a reply is spoken, which a fully muted room
never does. Turn either off and that lamp stays lit for ninety seconds
(`GRACE_S` in machine/machine.py; `LUCID_GRACE_S` shortens it for a test) and
then goes out on its own, with `grace` on `GET /machine` counting it down.
`POST /machine/models/{stt,tts}` with `{"wanted": true|false}` is how the page
says which of the two it is using; anything that actually asks a model for
something — a transcription, a chunk to speak — cancels a grace that is
running.

If a stage fails, it says so in words. What the console actually prints, and
what each one usually means:

| what the console says | cause |
|---|---|
| `the language model did not start`, then the server's own last lines under `llm` | wrong `llm.model` path, or `llm.venv` not holding `mlx_lm.server` |
| `the recognizer would not load: …` / `the voice would not load: …` | wrong model path, or the download is incomplete |
| `warming the recognizer — the key arms when it can hear you` | ordinary: the first **Talk** of a session loads it |
| `nothing has wanted the recognizer for 90 seconds — putting it away` | ordinary: the mic has been off that long |
| `microphone: no echo cancellation — use headphones` | this browser does not cancel; barge-in turns itself off |
| mic level stays 0 | microphone permission, or a virtual device selected |
| no sound | audio plays in the page — click once, browsers need a gesture |

---

## 5. The checks

```sh
./check.sh              everything there is
./check.sh store        one module of the fast suite, matched by name
./check.sh rooms        only the browser ones
```

Three tiers, in that order.

**Python.** The machine: nothing installed, no model and no device touched,
finishes in a second — run it before every commit.

**The page**, which is `npm run typecheck && npm run lint && npm test` in
`app/`. Most of the program is here now — the conversation runs in the browser
— and the compiler is most of the tier: a page that would not have parsed, or a
name used and declared nowhere, is a build that fails rather than a room with a
dead panel in it. Skipped where `app/node_modules` is not there.

**The rooms**, in a real browser: whether the pages come up at all, whether a
page knows which conversation it is in, and whether everything in a room can
still be pressed — none of which has an answer outside a browser that has
actually drawn one. The specs are `app/tests/browser/*.spec.ts` and they are
pointed at whatever is serving, so start `./run.sh` in another terminal first;
it works out whether that is http or https the way the server does, so no
certificate is needed. `./check.sh rooms` runs this one alone.

The driver comes with the page. The browser it drives is a download of its own,
once on this machine:

```sh
cd app && npx playwright install chromium
```

Both of the last two are skipped, loudly, on a machine that cannot run them —
which is a machine serving a page it did not build.

---

## 6. The phone

`./run.sh` serves the page on the local network as well; `--no-phone`, or
`"phone": false` in `userdata/config.json`, keeps it on loopback. A bridge is needed
because the macOS firewall grants incoming connections per binary and does not
know a `uv`-installed Python; the bridge runs on `/usr/bin/python3`, which it
does know.

**HTTPS is needed to talk from the phone.** Playback works over plain HTTP, so
without a certificate the phone still hears it and works as a remote. But
browsers only grant microphone access on a secure origin, and a self-signed
certificate is not enough on iOS -- it has to chain to something the phone
trusts:

```sh
brew install mkcert
sudo mkcert -install
mkcert -cert-file userdata/certs/lucid.pem -key-file userdata/certs/lucid-key.pem \
       "$(scutil --get LocalHostName).local" "$(ipconfig getifaddr en0)" localhost 127.0.0.1
```

Then set `tls_cert` and `tls_key` in `userdata/config.json` to those files —
a relative path is read from the checkout, so `userdata/certs/lucid.pem` survives
a move. Install
`$(mkcert -CAROOT)/rootCA.pem` on the phone — the profile alone is not enough,
it also needs enabling under **Settings → General → About → Certificate Trust
Settings**.

Playback works over plain HTTP; only capture needs the certificate.

---

## Layout

The code is two packages — the machine in Python, everything the browser runs
in `app/` — and your data sits beside them in the checkout, so nothing you have
written moves when the code is rearranged. A game is a package in the bundle
and a directory under your own: the machine has no list of games, no code of
one in this process, and no word for anything a game keeps.

```
machine/        the machine — `python -m machine`, or ./run.sh. It knows no game
  server.py     serves the built page, the console, and the routes below
  machine.py    /machine — chat, transcribe, speak, the lamps, the lifecycle
  models.py     LLM supervisor, speech to text, text to speech, audio DSP
  store.py      /store/<game>/{data,logs}/<path> — a value by path and an
                append-only log by path, and no idea what any of them hold
  voices.py     the shelf of clips: <voices.path>/<name>.wav, by name
  paths.py      where everything lives, decided once
  web.py        where the build is, and what is served without one
  config.py     the machine's own: phone, TLS, and the stack every game shares
  static/       the icons and the manifest, served at /shared/
models/         the shelf: one checkout per repository, <org>/<repo>, as
                published — never committed. machine/models.json says which is which
  voices/       the shelf: one clip per voice, <name>.wav. A persona names one;
                the machine resolves it and knows nothing else about it
app/            everything the browser runs — an npm workspace, built by Vite
  index.html    the one document; public/  the icons, as the dev server sees them
  src/main.tsx  the composition: which games are installed, and nothing else
  packages/
    shell/      @lucid/shell — what serves a game and knows nothing about one:
                the router, the shelf, the rail, the console, the sky, the
                sound, the QR code, the fit, the backend address, the manifest
    world/      @lucid/world — three.js and Rapier wired together, with no idea
                what is being simulated: a world with a fixed step, bodies
                measured off meshes, a shove, a settle, a replay, a character
                controller, a debug view. It imports nothing of ours
    audio/      @lucid/audio — the device side of sound, with no idea what is
                being said into it: the microphone, the speaker, the voice
                activity detection, the pacer and the call to the recognizer
    ui/         @lucid/ui — the mechanics every game reuses, each with its own
                stylesheet beside it: the open box with its lid, tray and card
                flight, the transport deck with its meter, the banners, the
                confirm dialog, the sheet frame, the transcript pane, the
                typing line, the stage and the glass. Nothing in it knows what
                a card is for; what goes on one arrives as a prop, and what
                goes on the stage arrives as a function that builds it
    machine/    @lucid/machine — the model side: chat as a stream, speak over
                a socket, status and lifecycle, the sentence pipeline, and
                `reply` — text streamed in, sentences spoken out, with hold,
                skip and interrupt — which any game with a speaking character
                needs
    talk/       @lucid/talk — Lucid Talk, and only what only it means: its
                manifest, which carries what the game ships tuned to; content/
                — a directory per character (persona.md) and its prompts, read
                into the bundle at build time; the box and room routes;
                conversation/ — the loop itself, the prompt, memory, standing,
                scene, hands, bundle.ts which parses the content, and files.ts,
                the one place its words become paths; link/ the state a room is
                drawn from; ui/ where it composes the mechanics above into a
                deck, three banners and three sheets; room/ — the machine that
                builds a room, which is this game's idea of a place and not a
                framework's: room3d, fittings and the spec, hand-set JavaScript
                with a typed face on it; and rooms/ — one .js and .css per
                character
  tests/browser/  playwright: what needs a browser that has drawn the page
  dist/         what `npm run build` writes and Python serves — not committed
VERSION         one line, semantic; shown in the box and in the console
userdata/       yours, never committed — see machine/paths.py
  config.json     the certificate, phone, and the stack every game shares:
                  the model, the recognizer, the voice, the mic thresholds
  certs/          the TLS keys
  players/<who>/  one directory per player; player1 unless --user said otherwise
    log/          what the console said
    lucid-talk/   one directory per game, laid out as that game names its
                  paths — the machine reads them and knows what none of them
                  hold. Lucid Talk's are:
      config.json    what this game is tuned to, where you differ from it
      memory/        what each character knows about you, and where you stand
      personas/<slug>/prompt.md      a character in your own words, over the
                     shipped body; absent means the shipped one
      personas/<slug>/tunables.json  and what you have set it to: temperature,
                     top_p, the voice. Both written from the console, in the
                     game -- what ships is never edited. See
                     app/packages/talk/src/conversation/persona.ts
      rooms/         one save per conversation: what your hands did in it
      sessions/      every conversation, one file each
    tmp/          scratch — llm.log, recordings, anything mid-experiment
tools/          phone.sh      certificates for the phone, and the three taps
                lan_bridge.py phone access
                voicecheck.py score a clip   voiceprep.py cut one from any audio
                VOICES.md     what makes a reference clip work, and why
```

A character with `draft: true` in its frontmatter is written but not offered:
no tile, no route, no voice needed. Two of the four are, for now.

A character is `app/packages/talk/content/personas/<slug>/persona.md` — the
words, and the name of the voice it speaks in. That file is the game's and is
not edited in play: a player changes a character from the console, and what
they change lands in their own directory above. Its room is game code and lives
with the rest of it: `app/packages/talk/src/rooms/<slug>.js` and the `.css`
beside it. Its voice is not a game's at all: `models/voices/<name>.wav`,
fetched with the weights, listed by `GET /machine/voices`, and named in the
frontmatter only when one character borrows another's.

Everything under `app/packages/talk/content/` is versioned: one copy of each
text, read into the bundle at build time. Nothing about the user is in the
repository — `data/`, `logs/`, `tmp/`, `userdata/config.json` and `certs/` are
ignored, and so are the clips.
