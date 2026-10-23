# Setting up Lucid Dream

One machine and the games that run on it. There are two so far — Lucid Talk,
in `app/packages/talk/`, and Lucid Trip, in `app/packages/trip/` — and
everything below is what they need. Lucid Talk needs the whole machine.
Lucid Trip is one card so far, Burning Man
(`app/packages/trip/src/trips/burning-man/`), which needs none of the models:
only the page, a licensed copy of threejs-water-pro beside the checkout to
build it, and the network for its song.

Instructions for a coding agent (or a person who likes a checklist). The goal
is a working `./run.sh` with the models on disk and `userdata/config.json`
pointing at them.

**Requirements:** Apple Silicon Mac, macOS 14+, Python 3.14, Node 24 with npm,
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

Python 3.14 from `uv`, which is also the fastest way to get it; 3.12 works too.

```sh
cd path/to/lucid-dream                    # wherever you cloned it
uv venv --python 3.14 --managed-python .venv
uv pip install --python .venv/bin/python -r requirements.txt
```

`--managed-python` is load-bearing: it is uv's own build of Python rather than
whatever else is on the machine. Homebrew's 3.14.8, measured on one Mac, takes
35 s to look up the name of 127.0.0.1, and `mlx_lm.server` asks for it when it
binds its port, so the language model took 36 s to start where it takes 1.4.
uv's build, and Apple's, answer at once.

`requirements.txt` is the list, and it ends with a commented block holding the
things only used to check the work — `pillow`, which measures the icon set in
`tests/machine/test_icons.py` and cuts it in `tools/cut_icons.py` (those tests
skip themselves when it is not installed, so the suite is green either way),
and `httpx2`, which Starlette's test client now wants in place of the `httpx`
that arrives with huggingface-hub; without it the suite warns and still passes.

Known-good versions: Python 3.14.7, mlx 0.32.3, mlx-lm 0.32.0, mlx-audio 0.5.8,
mlx-vlm 0.7.6, numpy 2.5.3, scipy 1.18.1. `sentencepiece` is only needed because `mlx_audio.sts` imports
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

`npm ci` wants one package that is not on npm: threejs-water-pro, the
desert's sea, a commercial library licensed per developer. `@lucid/world`
installs it from `threejs-water-pro`, a directory beside the checkout, never
inside it; without a licensed copy there the page does not build. See
[THIRD-PARTY.md](THIRD-PARTY.md).

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
thing a newer release edits to bring a newer model (a size may say
`"censored": true`, which the game guards against -- see the browser mode
section; none does). `./setup.sh` reads it,
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
intensity does nothing there. What it has instead is the delivery tags its
tokenizer knows (`[laugh]`, `[sigh]`, `[gasp]`…, read from the model's
`added_tokens.json`), kept and offered only where the tag map says the voice
says them well: with Turbo loaded a reply is offered those, the voice
performs them and the transcript never shows them; any other tag, and every
tag for any other voice, is stripped before synthesis. **The tag map** is
`app/packages/machine/src/voice-tags.json`, one entry per voice model (the
Mac's Turbo by its directory's name, a browser voice as `browser:<id>`), read
by the machine (`voice_tags` in machine/models.py) and the page
(`voice-tags.ts`); the prompt's list is what the loaded voice keeps, with no
second list anywhere. A voice with no entry keeps every tag its tokenizer
knows and the log says so; to give it one, render each of those tags at the
start of a sentence in a pill's clip, one WAV, and Eugene's ear decides what
goes under `say` and what under `not` (with a word on why). A tag is performed at the start of a sentence,
before its words: one with no words of its own rides on the sentence after it
and is never handed to the voice alone, which made noise of it (`hasWords` in
machine's speech.ts). The model is shown its own replies with their tags (a
turn's `sent`, beside the words in `content`, a lone tag moved onto the
sentence it opened), and a one-line reminder rides on his turn after a reply
that made no sound (`soundPress`, content/prompts/sounds_press.md). A voice that performs
none — full Chatterbox, Sopro in a browser, no voice, or the sound off — gets
the original approach instead: sounds written as words (mmm, ah, hah), never
named, never in square brackets. The prompt files carry both wordings where
they differ, `{if tags}…{else}…{end}` (`ifTags` in talk's prompt.ts), and the
room decides per reply from the voice that will speak it, so the front of the
prompt moves, and the cache misses once, only when that voice does.

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

That address is the shelf: a tile per game. Lucid Talk is at `/talk/`,
which opens a box of pills; taking one opens that pill's room at
`/talk/<name>`. Lucid Trip is at `/trip/`, a box with one card;
taking it opens Burning Man at `/trip/burning-man`, which is also its
deep link. All of them are one document — the routing is the page's —
and `./run.sh` on its own serves the built one out of `app/dist`. The
addresses are not the games' names: a player's files stay under
`lucid-talk/`, and the old `/lucid-talk/…` and `/lucid-trip/…` addresses
are moved to the new ones by the page.

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
| `the language model stopped answering (no new word in 15 s) — starting it again` | its server froze mid-reply: the reply is cut, the server killed and started afresh, and the room says the pill is being woken until its next word (90 s before the first word, `machine/models.py` FIRST_WORD_S) |
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

## 7. Without the machine: browser mode

The same build runs with nothing behind it — a static host, or a desktop
wrapper that brings no Python. Before it draws anything the page asks
`GET /machine` once (`settle`, `app/packages/machine/src/host.ts`); a machine
that answers in its own words is the machine, and anything else — a static
host's 404 page, a refused connection, `file://` — makes the page its own
machine. Never the hostname: a wrapper may load from `file://`, `app://` or a
random port.

What changes then is said in one place, `host()` in `@lucid/shell`, as
separate answers: where words come from (`llm`: machine, page, none), where
files are kept (`store`: machine, page), whether anything can speak,
hear, or has a console to dial, and whether the model in use is a censored
one (`censored`, below). Every machine and store route goes through one
seam, `call()` in `@lucid/machine`'s `address.ts`, and with no machine the
stand-in in `app/packages/machine/src/page/` answers it in-process:

- **words**: a Qwen3.5 build through WebLLM in a worker on WebGPU — 2B by
  default, 0.8B for a weaker device, 4B where the GPU looks strong — chosen
  on the first-open card and cached by the browser. No WebGPU (or only a
  software one) is a card saying so, with no CPU fallback. Any other WebGPU
  is let try: WebLLM checks the adapter's limits after the model's config and
  kernel library (about 6 MB) and before any weight, and its refusal
  ("requested maxStorageBuffersPerShaderStage exceeds limit. requested=10,
  limit=9" in Firefox 157) is said in the page's words (`outgrown` in
  `page/engine.ts`), the voice asked for in the same press is not fetched,
  and the page is `llm: 'none'` until the next visit, which tries again. No
  limit is counted or kept on our side. Loaded with 8192 tokens of context
  on every device but a weak one (`contextFor`; measured 10-10 in the comment
  there), 4096 on a weak one (a phone's tab past its memory is killed, not
  failed) and wherever the long load fails (loaded again short from the
  cache); `host().context` says which.
- **files**: store.py's contract, same paths and versions, in IndexedDB
  (`page/store.ts`, behind a `Drawer` a wrapper could replace with real files),
  keyed exactly as `userdata/` is laid out: `players/<who>/<game>/<path>`, and
  `config.json` at the root for the browser's own settings (the model it runs
  is `llm.size` there, its voice `tts.enabled` and `tts.engine`). The player
  is `?user=<name>` in the address, kept for that browser until another is
  asked for, `player1` by default, with
  paths.py's names (`page/userdata.ts`). In the console, `/files_export` writes
  the whole of it as a zip laid out as `userdata/` and `/files_import` reads
  one back — or one player's folder zipped on its own — refusing what the
  store would and keeping what is already there when the two differ
  (`/files_import replace` takes the zip's). `ai_model_size`,
  `ai_models_start`, `ai_models_stop` and `files_where` answer as on a Mac.
- **a voice, if asked for**: a speech model in a worker on WebGPU behind the
  machine's own voice socket (`page/voice.ts`, `page/voice-worker.ts`), chosen
  on the first-open card beside the language model (360-720 MB) and kept in
  that `config.json` as `tts.enabled` and `tts.engine`; after that the switch
  beside the mute is on or off, and on with nothing in the browser's cache
  opens the card at its voice. `/voice_engine` in the console picks the engine
  directly. Chatterbox Turbo by default (the machine's voice, cloned from the
  pill's clip, tags performed), Chatterbox Nano (only with shader-f16) or Sopro
  v2 Turbo, all three cloning. The clips are read from the voice pack on the
  hub at a pinned commit, as setup fetches it. Until it is up, and without it,
  replies come at the reading pace. While nothing can be heard (muted, or the
  knob at zero) it is never loaded -- chosen then, it is only fetched into the
  cache -- and one that is up is let go of after the machine's 90 s grace.
  It starts only once a load of the words under way has ended, up or failed
  (`settled` in `page/engine.ts`): on an iPhone Air (10-10) Turbo started
  beside the words coming down failed with onnxruntime-web's "no available
  backend found. ERR: [webgpu] RangeError: Out of memory". A voice that fails
  -- to come down, to start, or twice running to speak -- says why in plain
  words on its row in the models panel (`plainly` in `page/voice.ts`), the
  smallest one that has not failed is suggested in its place, and the words go
  on at the reading pace: never the room's "not answering" banner
  (`VoiceFailed`), never the words kept from loading. Everything the panel and
  the room's lamps read off `GET /machine` is bounded (`CHECK_MS` in
  `page/engine.ts`): a storage that does not answer gives the last answer, or
  "not checked", never a panel waiting on it; and a load of the words that
  says nothing for three minutes is put down and its reason said.
- **an ear, if asked for**: a speech model in a worker on the CPU
  (WebAssembly, one thread: a static host is not cross-origin isolated) put
  in front of `transcribe` (`page/ear.ts`, `page/ear-worker.ts`, the list in
  `page/ear-models.ts`; `heardBy` in @lucid/audio's stt.ts). On the CPU on
  purpose: the GPU is the words' and the voice's, and Firefox, whose WebGPU
  cannot run the words today, runs it. Everything else about hearing -- the
  microphone, the echo cancelling, the detector, the junk filter, the Talk
  key -- was the page's already and is the same code as on a Mac. Two ears,
  chosen by measurement on one thread (10-09, 48 turns, both pills' lines in
  three voices and one voice again under room and noise at 10 dB): Moonshine
  Base by default (67 MB, 2.5% of words wrong, 27% in the noise, a turn in
  0.07 of its length), and Parakeet, the Mac's own ear (661 MB, 1.8%, 3% in the
  noise, 0.32), for a noisy room. Whisper Base and Small were measured and
  left out: no better than Moonshine in a quiet room, and 0.5 and 2.0.
  Chosen in the models panel's microphone section (optional: typing is
  enough), kept in that `config.json` as `stt.enabled` and `stt.engine`; a
  Talk press with none in the cache opens the panel there. Loaded when the
  microphone is turned on (`POST /machine/models/stt`, as on a Mac) and let go
  of after the machine's 90 s grace once it is off. `host().ear` is whether
  this browser can run one at all; the `ear` limit holds only where it
  cannot (no WebAssembly, or no microphone on an address the browser does not
  trust).
- **keeping the downloads**: the models (WebLLM's caches, transformers-cache,
  Sopro's sopro-onnx-*) and the player's files sit in this origin's storage,
  which a browser may clear -- Chrome under disk pressure, Safari after a week
  without a visit -- until the page is granted persistence. `keepDownloads`
  (`page/keep.ts`) asks for it on every download and load (the words, the
  voice, the ear), and once an open when a model is cached and the storage is
  not yet persisted (settle). Chrome and Safari never prompt (Chrome weighs
  engagement, a bookmark, an install; Safari mostly the Home Screen or the
  Dock), so they are asked freely; Firefox prompts, so it is asked only from a
  press, once in that browser, never on an open. Refused, the page works as
  before and the console says once what would keep them. The storage is per
  origin: a page at another address downloads its own copy. Nothing of ours
  deletes a good download: the voice worker's sweep removes only the files it
  names as no longer read (Turbo's q4f16 speech encoder).
- **prompts**: the judgement, the scene and the fold are tuned for a
  one-conversation cache, and the window for the context the words were
  loaded with -- the machine's six exchanges and 600 words at 8192, four and
  400 at 4096 (`PAGE_DEFAULTS` and `defaults` in
  `talk/src/conversation/config.ts`; an open room re-reads it when
  `host().context` moves); the scene being off there, the room is
  said once at the end of the system prompt rather than on every line
  (`placedOnce` in turn.ts, on any host with the scene off; pressed on every
  line, the 4B opened 60% of its replies on the room). The machine's own
  window does not move.
- **censored builds**: every build here is flagged `censored` (`BUILDS` in
  `page/engine.ts`): the 4B, unlike the Mac's 4-bit of the same weights,
  sometimes answers as the model ("I can't continue this roleplay. I am an
  AI..."), and once one is in the window it repeats on most turns -- the
  research put it down to the MLC packing, not to the browser. What follows
  is keyed on the flag, not on where the model runs, so a Mac model flagged
  in `machine/models.json` gets the same (none is). The flag is said on
  `GET /machine` as `llm.censored` and kept as `host().censored` off every
  read of it (`status()` in `status.ts`; in a browser also as the engine
  moves). A censored model's system prompt is
  `content/prompts/system_page.md`: the text-mode prompt a Mac without its
  voice uses (`system_text.md`: first person, no asterisks), opened the way
  system.md opens, "You are heard aloud, not read." -- system.md's voice
  lines are not in it: tried there, the 4B wrote most replies as asterisk
  stage directions (`prompts()` in bundle.ts; re-read by an open room when
  the flag moves). And every ask of it goes through the refusal guard
  (`talk/src/conversation/refusal.ts`: `chat`, `inCharacter`), between the
  stream and the voice and the glass: each reply's opening is judged before
  a word is handed out, one that refuses is cut -- an abort of the stream,
  which stops the machine's loop and the engine's worker alike -- and asked
  for once more; a second refusal is shown, and the game keeps it out of the
  window, the fold and the judgement (`readAgain` in character.ts). With
  nothing flagged, none of it runs.
- **content**: the pills keep sex off the page in a browser -- a scene that
  gets that close cuts away, in character, never refused as a program.
  `content/prompts/page_limits.md` is added to the browser's system prompt,
  before the persona, by `prompts()` in bundle.ts, and dropped everywhere
  else; nothing on a Mac. Every word of it moves how often the small model
  falls back to its own refusal ("As an AI assistant, I can't continue this
  roleplay"): measured on the 4B, lover, explicit and suggestive lines, 0 of 28
  replies with no line, 1 of 32 with this one; a line that named sex, or sat
  after the persona, took it to 7-11 of 16-32. Measure in a browser before
  changing it.

**What is smaller is said, not hidden.** Every part that is off or smaller in
a browser stays where it is and wears one mark (a broken ring); a press says
what it is on your Mac, what it is here, and the steps to run it there. The
list is `limits.ts` in @lucid/shell -- each entry an id, a name, the two
lines, and a `holds` read at the moment (a player whose config.json switched
where they stand back on is not told it is held) -- written to by the shell
(the phone) and by a game (`talk/src/limits.ts`: where you stand, speaking,
the model's size, memory, the window, the scene, content). The mark, the note
and the steps are `@lucid/shell`'s `Mark`, `LimitNote` and `RunOnMac`; a
sheet for one is `openLimit(id)` in @lucid/ui. The steps are the landing
page's (`docs/index.html`, `.steps`), held equal by `limits.test.ts`. On a Mac
none of it draws.

**A build for a static host.** `LUCID_BASE` says where it is served from and
makes it one; `LUCID_SITE` is the origin, for link previews. For GitHub Pages:

```sh
cd app && LUCID_BASE=/lucid-dream/ LUCID_SITE=https://excelsior-arts.github.io npm run build
```

Beside the one document it writes a copy at every address the house knows
(`talk/`, `talk/<pill>/`, `trip/`, `trip/<trip>/`), each with its own title
and `og:` lines, `404.html` for any other address, and the web manifest
under the base (`app/static-host.ts`). Every address is previewed by a JPEG
in `docs/og/`, named by its address (`shelf.jpg`, `talk.jpg`,
`talk-lover.jpg`, `trip-burning-man.jpg`), 1200x630 with the subject in the
middle square; one without its own takes its game's, then the shelf's, and
with no `shelf.jpg` the build stops. `docs/og/alt.json` says what a picture
shows. It does not ask for a machine. The machine's build is the one with neither set,
served at `/`; never hand the machine a build made for a base. To look at one
here, serve `app/dist` under that path with a server that answers a missing
file with `404.html` and a 404, as Pages does, in a browser with WebGPU.
Burning Man's song is signed by a lambda (`trips/burning-man/audio/music-cdn.json`)
that answers only the origins it allows: a new host's origin has to be added
there. A wrapper says what it is before the bundle
runs, on `globalThis.__LUCID_HOST__` — `{machine: false}`, any of the answers
above, or `answer`, its own function for the routes.

**The first-open card** is the same card on both, and the one place anything
is downloaded: a room opened with nothing to run asks which model
(`talk/src/ui/ModelCard`), from `GET /machine`'s `llm.offer`, and beside it the
voice and the ear from its `shelf`, with one total and one bar. On a Mac with
no model on its shelf it offers the manifest's three sizes with this Mac's
suggested by setup's rule (`shelf.pick`), and Chatterbox Turbo and Parakeet
where they are missing, ticked; `POST /machine/models/fetch` (`{size, voice,
ear}`, any of them) brings them down and starts the model. Either part can be
left out for a machine that only reads and types: its voice switch on the rail
and its microphone then say the part is not on this Mac and open the card at
it. A Mac with everything never sees it unasked. The gear in the corner of the
box's lid always opens it, as the models panel: three sections -- the language
model (required: the smallest is the minimum, the one for this Mac's memory or
this browser's GPU recommended), the voice (recommended), the microphone
(optional: typing is enough) -- each row saying whether it is downloaded and
which is in use, a downloaded size chosen there put in use (`llm.size`). The
rail's voice switch and microphone open it at their section, from the box or
a room, and `/model_choose` in a room opens it too.

---

## Layout

The code is two packages — the machine in Python, everything the browser runs
in `app/` — and your data sits beside them in the checkout, so nothing you have
written moves when the code is rearranged. A game is a package in the bundle
and a directory under your own: the machine has no list of games, no code of
one in this process, and no word for anything a game keeps.

```
docs/           ARCHITECTURE.md — the snapshot: every loop, marked model or code;
                read it before proposing a mechanism that may already exist
machine/        the machine — `python -m machine`, or ./run.sh. It knows no game
  server.py     serves the built page, the console, and the routes below
  machine.py    /machine — chat, transcribe, speak, the lamps, the lifecycle
  models.py     LLM supervisor, speech to text, text to speech, audio DSP
  store.py      /store/<game>/{data,logs}/<path> — a value by path and an
                append-only log by path, and no idea what any of them hold
  voices.py     the shelf of clips: <voices.path>/<name>.wav, by name
  assets.py     the other shelf: <assets.dir>/{sounds,figures}/<name>, by kind
                and name -- a footstep, wind, a body. Never committed: they
                live in lucid-assets beside this. A name with nothing is silence.
                Stocked for the walk; nothing plays or draws from it now
  paths.py      where everything lives, decided once
  web.py        where the build is, and what is served without one
  config.py     the machine's own: phone, TLS, and the stack every game shares
  static/       the icons and the manifest, served at /shared/
models/         the shelf: one checkout per repository, <org>/<repo>, as
                published — never committed. machine/models.json says which is which
  voices/       the shelf: one clip per voice, <name>.wav. A persona names one;
                the machine resolves it and knows nothing else about it
  assets/       where a clone of lucid-assets goes unless assets.dir says
                otherwise: sounds/<name>.m4a, figures/<name>.glb
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
                controller, a debug view. It imports nothing of ours.
                src/desert/ (@lucid/world/desert) is the desert a trip stands
                in, lifted out of Burning Man with its arithmetic intact; its
                index.ts and the headers it points at are the design document.
                landscape.ts a Landscape as plain data and Geography, the
                functions it makes; layout.ts the dune language; sand/ the
                field, grains, terrain and height atlas; render/ the TSL
                graphs; scene/ createDesert -- sand, mountains, sky, sun and
                moon, fog, the hour, a trip's landmarks -- and the sea;
                camera/ the orbit, the follow camera and WalkKeys; loop/ the
                frame loop and the graphics budget; walker.ts with the Gait
                injected; sound/ wind, surf, steps and the song under a Mix,
                with a trip's SoundLayers; stage.ts the markup and the loading
                screen. Depends on three 0.186.1, Rapier, and threejs-water-pro
                from a licensed copy beside the checkout (see THIRD-PARTY.md)
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
                — and host.ts, which asks once whether a machine is there;
                page/ is the machine a page with none stands in with: the
                routes (machine.ts), the files in IndexedDB (store.ts), and
                a small Qwen through WebLLM in a worker (engine.ts, worker.ts)
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
                character. conversation/character.ts is the one piece another
                game may import: a persona with the player's files over it,
                its memory and standing and the two calls that move them
    trip/       @lucid/trip — Lucid Trip: a box of trips, one so far. trips/
                index.ts lists every trip (TRIPS); trips/trip.ts the types
                (TripCard, Piece, Mount, Trip). A trip is a directory under
                trips/ and a line in that list; it stands in the desert and
                imports nothing of ours but @lucid/world. trips/burning-man/
                is what is his: landscape.ts his numbers, character/ the body
                and its gaits, render/ and runtime/ the fire, experience/ the
                score (authored upstream as score.json), the director, the
                camera director and piece.ts, world/ the altars and the fallen
                tribute, audio/ his heartbeat and fire over the desert's sound
                and the signer for his song, assets/ the body served hashed
                under /assets, index.ts mount(host) -> {ready, dispose, hear}, trip.ts
                his card, lab/ his suites (ground-identity holds his ground to
                the double). manifest.ts the routes, '' the box and ':card' a
                trip; routes/box/ the cards off TRIPS and the lid's table, a
                line per card with how many times it has been taken;
                routes/trip/Trip.tsx opens, mounts and disposes a trip, and
                counts a dose when Let it is pressed. doses.ts is the count,
                the one thing kept, in the machine's store.
                Depends on shell, machine, ui, world, react and three 0.186.1
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
      sessions/      every conversation, one file each -- a room's. Older
                     walks' sessions, headed `game: lucid-trip`, may be here
                     too; nothing writes them now.
    lucid-trip/   Lucid Trip's, which is one thing:
      doses/<card>.jsonl  a line each time that trip was begun (Let it), and
                     nothing else of it. See app/packages/trip/src/doses.ts
    tmp/          scratch — llm.log, recordings, anything mid-experiment
tools/          phone.sh      certificates for the phone, and the three taps
                lan_bridge.py phone access
                voicecheck.py score a clip   voiceprep.py cut one from any audio
                soundprep.py  cut the sound pack out of a sound library: the
                              table of which recording each name comes from
                figureprep.mjs a figure for the shelf out of a Mixamo download.
                              It made the walk's figure; nothing draws it now
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
