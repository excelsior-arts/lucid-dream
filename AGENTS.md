# Setting up Lucid Dream

One shell and the apps it carries. There is one app so far — Lucid Talk —
and everything below is what it needs.

Instructions for a coding agent (or a person who likes a checklist). The goal
is a working `./run.sh` with the models on disk and `userdata/config.json`
pointing at them.

**Requirements:** Apple Silicon Mac, macOS 14+, Python 3.12, ~30 GB disk, and
enough RAM to hold the models — the app's own meter reports ~31 GB mid-reply
with the default 27B 4-bit LLM, so 32 GB is the floor. Verify before starting:

```sh
uname -m                                  # expect arm64
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

`requirements.txt` is the list, and it ends with a commented block of things
only used to check the work — `segno`, `reedsolo` and `opencv-python`, which
exist so the QR encoder in `shell/static/qr.js` can be tested against
reference implementations and read back off a screenshot.

Known-good versions: mlx 0.32.1, mlx-audio 0.5.0, mlx-vlm 0.6.14, numpy 2.5.2,
scipy 1.18.0. `sentencepiece` is only needed because `mlx_audio.sts` imports
Moshi at package level; without it the speech-enhancement import fails.

Check it:

```sh
.venv/bin/python -c "import mlx.core as mx; print(mx.default_device())"   # Device(gpu, 0)
```

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
answers it. The footer reports what the microphone track actually granted
(`echo canceled`), because asking for cancellation is not getting it.

---

## 2. Models

Three, into `models/` beside the code, plus a tokenizer that fetches itself.
None is gated and none needs a Hugging Face account — Apache-2.0 and
CC-BY-4.0, downloaded anonymously. `./setup.sh` does all of this; by hand:

```sh
DL='.venv/bin/python -c'

# 1. the language model — the personality. ~16 GB.
# One repo holds every quantisation of itself, so take the 4-bit and nothing
# else: without allow_patterns this pulls about 95 GB to use 16 of it.
$DL "from huggingface_hub import snapshot_download as d; d('orcarouter/Qwen3.8-27B-Uncensored-MLX', local_dir='models/llm', allow_patterns=['4-bit/*'])"

# 2. speech to text — Parakeet. ~2.5 GB.
$DL "from huggingface_hub import snapshot_download as d; d('mlx-community/parakeet-tdt-0.6b-v2', local_dir='models/parakeet-tdt-0.6b-v2')"

# 3. text to speech — Chatterbox Turbo, which clones a voice from a clip. ~2.8 GB.
$DL "from huggingface_hub import snapshot_download as d; d('mlx-community/chatterbox-turbo-fp16', local_dir='models/Chatterbox-Turbo-fp16')"
```

`models/` sits beside the code so the whole thing stays one directory you can
move or delete, and it is in `.gitignore`. To keep them elsewhere — a disk of
their own, or a pile shared between checkouts — download them there and write
that path in step 3: a config path starting with `/` or `~` is taken as given,
anything else is read from the checkout.

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
roughly 13-16 tokens/s on an M-series laptop. Match it to the machine:

| RAM | reasonable |
|---|---|
| 32 GB | the 27B 4-bit that ships, with the desktop kept quiet |
| 48 GB+ | the same, with room to spare, or 6-bit |

Smaller is a real downgrade rather than a smaller version of the same thing:
a 9B abliterated build, run against these personas, leaked the room description
into spoken dialogue, echoed the player's own line back, lost track of who was
speaking, and could not hold an argument across five turns. It answers in a
second. It is not this game.

Quantisation is a memory/quality trade. 6-bit is noticeably better and ~6 GB
larger; on a 48 GB machine with a browser and an editor open it pushed this one
into swap, which is far worse than the quality gain.

---

## 3. Configure

There are two, at different levels (see `shell/paths.py`). The machine's
`userdata/config.json` holds the certificate, whether the wifi address is
offered, and **the stack every game shares**: the language model, the
recognizer, the voice, and the microphone's thresholds — one of each, however
many games the shelf carries. A game's own
`userdata/players/<who>/<game>/config.json` holds only what is that game's; for
Lucid Talk that is what it remembers and how long a dose runs. `<who>` is
`player1` unless `./run.sh --user` said otherwise. The port is in neither and
never is: `./run.sh --port`, 6969 by default, and nothing on disk remembers it.

Write the model paths in:

```sh
.venv/bin/python - <<'PY'
import json, pathlib
p = pathlib.Path("userdata/config.json")
c = json.loads(p.read_text()) if p.exists() else {}
c.setdefault("llm", {}).update({"model": "models/llm", "venv": ".venv/bin"})
c.setdefault("stt", {}).update({"model": "models/parakeet-tdt-0.6b-v2"})
c.setdefault("tts", {}).update({"model": "models/Chatterbox-Turbo-fp16"})
p.write_text(json.dumps(c, indent=2))
PY
```

Relative to the checkout, which is how any path not starting with `/` or `~` is
read — so the file survives the directory being moved and says the same thing
on every machine. Absolute still works, for models kept elsewhere.

A config written before the stack moved up still works: whatever a game's file
carries of it is lifted into the machine's the first time that game is opened,
and the game's file is rewritten without it.

`llm.venv` must be the directory holding `mlx_vlm.server` — the app launches
the language model as a child process from there.

`run.sh` runs the app from that same directory — it reads `llm.venv`, falls
back to a `.venv` in the checkout, and there is nothing in the script to edit.

---

## 4. Verify

```sh
./run.sh
```

Expected output, then the app is reachable at the printed address:

```
lucid dream  ->  http://127.0.0.1:6969
```

That address is the shell: a tile per game. Lucid Talk is at `/lucid-talk/`,
which opens a box of pills; taking one opens that pill's room at
`/lucid-talk/<name>`.

Take a pill, then type a line or press **Talk** and say one. Nothing is started
by hand: the first thing you say loads what it needs. Open the console — the
last button in the right-hand rail — and watch:

```
persona: Thinker
starting the language model on :6968 …
LLM ready
loading Parakeet …
loading the voice …
ready — just talk
```

It should answer in text and out loud a few seconds later; only the first reply
of a session waits for the models. `/ai_models_start` loads them without
saying anything, and `/ai_models_stop` unloads them and gives the memory back —
the console shows how much was held.

If a stage fails, the log says which. Common causes:

| symptom | cause |
|---|---|
| `LLM failed` | wrong `llm.model` path, or `llm.venv` not holding `mlx_vlm.server` |
| `STT failed` / `TTS failed` | wrong model path, or the download is incomplete |
| mic level stays 0 | microphone permission, or a virtual device selected |
| no sound | audio plays in the page — click once, browsers need a gesture |

---

## 5. The checks

```sh
./check.sh              everything there is
./check.sh relation     one module of the fast suite, matched by name
./check.sh rooms        only the browser ones
```

Two tiers. The fast one is Python, needs nothing installed, touches no model
and no device, and finishes in six seconds — run it before every commit. The
other opens the rooms in a real browser and asks whether the pages come up and
whether everything in them can still be pressed, which has no answer outside a
browser that has actually drawn one. It needs `node` and `playwright`, and it
says so with the command to fix it if either is missing.

Playwright is worth installing once for the machine rather than per checkout —
this repository has no `package.json` and nothing else in it needs npm:

```sh
npm install -g playwright
npx playwright install chromium webkit firefox
```

Nothing to set afterwards: `tools/browsers.mjs` asks npm where it keeps global
packages. `LUCID_PLAYWRIGHT` is for one kept somewhere npm does not know about,
and may name the directory or the file inside it.

The browser tier also needs something to look at: start `./run.sh` in another
terminal first. It works out whether that is http or https the way the server
does, so no certificate is needed.

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

The code is a package; the characters and your data sit beside it in the
checkout, so nothing you have written moves when the code is rearranged.

```
shell/          the shell — `python -m shell`, or ./run.sh
  server.py     the tile page; mounts each app under a route of its own
  apps.py       what is installed        config.py    phone, TLS
  static/       the front page
lucid_talk/     the first app, served at /lucid-talk/
  session.py    the conversation: turn loop, continuous mode, the stack
  server.py     the page, the websocket, the command table
  audio.py      microphone, voice activity detection
  models.py     LLM supervisor, speech to text, text to speech, audio DSP
  memory.py     the rolling summary
  relation.py   where you stand with the pill: warmth, trust, mood
  scene.py      where the two of you are, carried past the window
  personas.py   persona files       prompts.py   prompt files
  store.py      transcripts         config.py    tunables
  rooms.py      what a conversation did to the room it happened in
  paths.py      where everything lives, decided once
  static/       the page
  personas/     a markdown file per character   prompts/   what it sends
  voices/       one reference clip per persona, named after it
VERSION         one line, semantic; shown in the box and in the console
userdata/       yours, never committed — see shell/paths.py
  config.json     the certificate, phone, and the stack every game shares:
                  the model, the recognizer, the voice, the mic thresholds
  certs/          the TLS keys
  players/<who>/  one directory per player; player1 unless --user said otherwise
    log/          what the console said
    lucid-talk/   one directory per game
      config.json    what this game is tuned to
      memory/        what each character knows about you, and where you stand
      sessions/      every conversation, one file each
      rooms/         one save per conversation: what your hands did in it
      tmp/           scratch — llm.log, recordings, anything mid-experiment
tools/          lan_bridge.py phone access
                voicecheck.py score a clip   voiceprep.py cut one from any audio
                VOICES.md     what makes a reference clip work, and why
```

A character with `draft: true` in its frontmatter is written but not offered:
no tile, no route, no voice needed. Two of the four are, for now.

`personas/`, `prompts/` and `voices/` are versioned: one copy of each text and
clip, the one the app reads. Nothing about the user is in the repository —
`memory/`, `sessions/`, `tmp/`, both `config.json` files and `certs/` are
ignored.
