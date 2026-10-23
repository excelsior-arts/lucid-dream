# What this stands on

The [license](LICENSE) covers what was made here — the code, the writing, the
rooms and how they are drawn — and nothing else. Every piece below belongs to
whoever wrote it and is used under its own terms, none of which this project
can change and none of which changes this one.

Nothing here is committed that somebody else wrote, with one exception named
below. The Python packages are installed from PyPI onto your machine by
`setup.sh`, the models are downloaded from Hugging Face into `models/`, the
browser's packages are installed from npm into `app/node_modules` -- all but
one, which comes from a licensed copy beside the checkout -- and all of that is
in `.gitignore`. What this repository holds is the code, the personas, the
rooms, and Burning Man's figure, whose skeleton and motions are Mixamo's.

The npm packages are the ones that end up *inside* something: `npm run build`
writes them into `app/dist`, which is the file a browser downloads. They are
listed below with the versions pinned in `app/packages/*/package.json`, and a
check makes sure none of them is missing from the list.

## The models

Downloaded on setup, never redistributed. Their terms are on their model cards.

| model | what it does | license |
| --- | --- | --- |
| [mlx-community/Qwen3.8-27B-4bit](https://huggingface.co/mlx-community/Qwen3.8-27B-4bit) | the language model — what a pill says; the large size | Apache-2.0 |
| [mlx-community/Qwen3.5-9B-MLX-4bit](https://huggingface.co/mlx-community/Qwen3.5-9B-MLX-4bit) | the same, the middle size | Apache-2.0 |
| [mlx-community/Qwen3.5-4B-MLX-4bit](https://huggingface.co/mlx-community/Qwen3.5-4B-MLX-4bit) | the same, the small size | Apache-2.0 |
| [mlx-community/parakeet-tdt-0.6b-v2](https://huggingface.co/mlx-community/parakeet-tdt-0.6b-v2) | speech to text — hearing you | CC-BY-4.0 |
| [mlx-community/chatterbox-turbo-fp16](https://huggingface.co/mlx-community/chatterbox-turbo-fp16) | text to speech — the voice | Apache-2.0 |
| [mlx-community/S3TokenizerV2](https://huggingface.co/mlx-community/S3TokenizerV2) | fetched by the voice model on first use | Apache-2.0 |

The reference clips the voices are cloned from are not in this repository
either, for the same reason and one more: a clip is six seconds of somebody's
speech, and that is the one thing here which cannot be taken back once it is
published. They live in a dataset of their own, so they can be replaced or
withdrawn without this repository being involved, and a clip offered in a pull
request has nowhere to land. Provenance for each one is on its page.

| pack | what it does | license |
| --- | --- | --- |
| [excelsior-arts/lucid-voices](https://huggingface.co/datasets/excelsior-arts/lucid-voices) | the voice each pill is cloned from | CC-BY-NC-4.0 |

The sounds -- a footstep, the wind, an ember taken -- and the figure the walk
was taken in are files too, and are not here either. They were made for Lucid
Trip's walk, which has gone, and nothing in the app plays or draws them now;
the shelf and its tools are still here. They live in
**lucid-assets**, a repository beside this one, and the machine serves them
from wherever `assets.dir` points. What this repository holds about them is
the two tools that make them and what those write down: `tools/soundprep.py`
is the table of which recording each sound is cut from and how, and
`tools/figureprep.mjs` writes the source file and its hash beside the figure
it makes. The libraries they are made from:

| library | what it does | license |
| --- | --- | --- |
| [Adobe Audition Sound Effects](https://www.adobe.com/products/audition/offers/adobeauditiondlcsfx.html) | the sounds of a walk: the desert, the feet, the things on the ground | Adobe's terms on that page: use, modify, reproduce and distribute the files within a work; not on a standalone basis, and no trademark in them |
| [Mixamo](https://www.mixamo.com) | the runner: a character and six of its clips (idle, walk, run, jump, running jump, flying knee), with the look replaced | Adobe's Mixamo terms: royalty-free in your own projects, modified or not; not redistributed on their own |

Both say the same thing, which is why the shelf is a repository of its own
and not a directory here: a pile of clips and characters is the standalone
distribution those terms rule out, and inside a game they are what the terms
allow. Point `assets.dir` at a shelf made from anything else and its terms
apply instead.

Point `llm.model` somewhere else and that model's license applies instead —
several of the community ones are gated and carry terms you accept on their
page. That is between you and whoever published it.

**A voice you add is not covered by anything here.** Cloning copies somebody's
delivery from a clip of them speaking; whether you have the right to that clip,
and to what it produces, is yours to answer.

## Python packages

Installed from PyPI. Licenses as declared by the packages themselves.

| package | license | home |
| --- | --- | --- |
| mlx | MIT | https://github.com/ml-explore/mlx |
| mlx-lm | MIT | https://github.com/ml-explore/mlx-lm |
| mlx-audio | MIT | https://github.com/Blaizzy/mlx-audio |
| mlx-vlm | MIT | https://github.com/Blaizzy/mlx-vlm |
| sentencepiece | Apache-2.0 | https://github.com/google/sentencepiece |
| huggingface-hub | Apache-2.0 | https://github.com/huggingface/huggingface_hub |
| fastapi | MIT | https://github.com/fastapi/fastapi |
| uvicorn | BSD-3-Clause | https://uvicorn.dev/ |
| websockets | BSD-3-Clause | https://github.com/python-websockets/websockets |
| requests | Apache-2.0 | https://github.com/psf/requests |
| numpy | BSD-3-Clause, and 0BSD / MIT / Zlib / CC0-1.0 for vendored parts | https://numpy.org |
| scipy | BSD-3-Clause | https://scipy.org/ |

All permissive: MIT, Apache-2.0, BSD. **No copyleft anywhere in the chain**,
which is what makes a noncommercial license on this code possible in the first
place — GPL code cannot be redistributed under added restrictions.

The one thing that looks like an exception is not one: SciPy ships libgfortran
under GPL-3.0 **with the GCC Runtime Library Exception**, which exists exactly
so that compiled output does not inherit copyleft.

Transitive dependencies come with those packages and are governed by their own
terms; `pip show` or `uv pip list` will name whatever your machine actually
installed.

## What the page is built from

Installed from npm and bundled by Vite. MIT and Apache-2.0, which is the same
permissive shape as everything on the Python side and for the same reason: the
one thing that cannot be in this chain is copyleft. The one package that is not
permissive is not copyleft either: the desert's sea is a commercial library,
below.

| package | version | license | home |
| --- | --- | --- | --- |
| three | 0.186.1 | MIT, © three.js authors | https://threejs.org |
| @dimforge/rapier3d-compat | 0.21.0 | Apache-2.0, © Dimforge SAS | https://rapier.rs |
| react | 19.3.0 | MIT, © Meta Platforms, Inc. | https://react.dev |
| react-dom | 19.3.0 | MIT, © Meta Platforms, Inc. | https://react.dev |
| react-router | 8.4.0 | MIT, © React Training LLC / Remix Software | https://reactrouter.com |
| zustand | 5.0.15 | MIT, © Paul Henschel | https://github.com/pmndrs/zustand |
| @mlc-ai/web-llm | 0.2.85 | Apache-2.0, © MLC contributors | https://github.com/mlc-ai/web-llm |
| @huggingface/transformers | 4.3.1 | Apache-2.0, © Hugging Face | https://github.com/huggingface/transformers.js |
| @soprotts/onnx-web | 0.3.0 | Apache-2.0, © the Sopro authors (no copyright line in the package) | https://github.com/samuel-vitorino/sopro |
| parakeet.js | 1.4.4 | MIT, © Yunus Seyhan Dede | https://github.com/ysdede/parakeet.js |
| threejs-water-pro | `file:../../../../threejs-water-pro` — a licensed copy beside the checkout | commercial, © DRG Software Solutions LLC, licensed per developer | https://threejsroadmap.com/assets/threejs-water-pro |

**three.js** draws both games: the talk rooms with its classic renderer,
Burning Man with its WebGPU build, falling back to WebGL2.

**[meshoptimizer](https://github.com/zeux/meshoptimizer)** arrives inside
three.js as the decoder for Burning Man's compressed figure, and the piece
cannot draw the body without it. It is MIT under its own copyright rather than
three.js's ([license](https://github.com/zeux/meshoptimizer/blob/master/LICENSE.md)).

**[WebLLM](https://github.com/mlc-ai/web-llm)** runs the language model in
the browser on a page with no machine behind it (browser mode, see
docs/ARCHITECTURE.md), and is loaded only there. Its compiled kernels come from
[binary-mlc-llm-libs](https://github.com/mlc-ai/binary-mlc-llm-libs) (Apache-2.0)
and the weights -- the `mlc-ai/Qwen3.5-*-MLC` builds of Qwen3.5, Apache-2.0 like
the machine's -- from the Hugging Face hub, both at pinned commits and both
fetched by the visitor's browser when they choose one; neither is bundled or
served from here.

**[transformers.js](https://github.com/huggingface/transformers.js)** and
**[Sopro's web runtime](https://github.com/samuel-vitorino/sopro)** speak the
replies on a page with no machine, when a voice is chosen there (browser mode),
and are loaded only then, in the voice's worker. Both run on
[ONNX Runtime Web](https://github.com/microsoft/onnxruntime), MIT, © Microsoft,
which arrives inside them with its WebAssembly files. The weights -- Resemble
AI's [chatterbox-turbo-ONNX](https://huggingface.co/ResembleAI/chatterbox-turbo-ONNX)
(MIT), the community [chatterbox-nano-ONNX](https://huggingface.co/owensong/chatterbox-nano-ONNX)
(MIT) and [sopro-v2-turbo-onnx](https://huggingface.co/samuel-vitorino/sopro-v2-turbo-onnx)
(Apache-2.0) -- and the reference clips (the voice pack above) come from the
Hugging Face hub at pinned commits, fetched by the visitor's browser when they
switch the voice on; none of them is bundled or served from here. Kokoro was
measured beside them and left out: kokoro-js speaks through `phonemizer`,
which has eSpeak NG (GPL-3.0) compiled into it.

**transformers.js** and **[parakeet.js](https://github.com/ysdede/parakeet.js)**
hear the microphone on a page with no machine, when an ear is chosen there in
the models panel (browser mode), and are loaded only then, in the ear's worker,
on ONNX Runtime Web's WebAssembly (parakeet.js brings its own copy, 1.24.1,
which it pins). The weights -- Useful Sensors' Moonshine Base as
[moonshine-base-ONNX](https://huggingface.co/onnx-community/moonshine-base-ONNX)
(MIT), and NVIDIA's Parakeet TDT 0.6B v2 (CC-BY-4.0, the Mac's ear above) as
[parakeet-tdt-0.6b-v2-onnx](https://huggingface.co/ysdede/parakeet-tdt-0.6b-v2-onnx)
-- come from the Hugging Face hub at pinned commits, fetched by the visitor's
browser when they choose one; neither is bundled or served from here.

**[threejs-water-pro](https://threejsroadmap.com/assets/threejs-water-pro)** is
the desert's sea: a commercial library from DRG Software Solutions LLC,
licensed per developer. It is a dependency of `@lucid/world`, whose desert
(`app/packages/world/src/desert/`) draws the sea every trip that stands there
looks out on — Burning Man's ocean, so far. Its licence allows its compiled
code to be deployed inside a finished work and forbids publishing its source,
so this repository holds neither the library nor any part of it in source
form: it is installed from a copy kept outside the checkout, beside it, and
only the compiled ocean reaches `app/dist`. Building from a clone of this
repository therefore needs your own licensed copy of that package.

What builds and checks the page — Vite, TypeScript, Vitest, Playwright, ESLint,
and their own dependencies — is installed the same way and is in
nothing that is served, so it is not listed here; `app/package.json` — the
workspace root, where the tooling belongs — names it all, and `npm ls` will say
what your machine actually installed.

## In the repository

| what | where | license |
| --- | --- | --- |
| PolyForm Noncommercial 1.0.0 | `LICENSE` | the license text itself, from polyformproject.org |

Burning Man's figure is in `app/packages/trip/src/trips/burning-man/assets/`.
The body was modelled for the piece, in Blender, and belongs to this project.
The skeleton it is built on and the motions it performs -- walking, turning,
shifting weight, giving way, rising and kneeling -- are from
[Adobe Mixamo](https://www.mixamo.com). Mixamo's terms allow that inside a
finished work and do not allow the characters or motions to be passed on as
assets for someone else to use. So they are here only as this piece:
retargeted, packed into the files the page loads, and offered to nobody as a
download. The original captures are not in this repository.

Burning Man's music is not in the repository and is not served by the machine:
the page fetches it over the network when the card is turned over, from an
address it is handed for that one play.

Everything else under `machine/`, `app/`, `tools/` and `tests/` — including the
personas and the rooms — was written for this project and is covered by
[LICENSE](LICENSE). The voices are not in the repository at all: a reference
clip is fetched by `setup.sh` into `models/voices/` from the dataset named
above, and never committed. Nor are the sounds and the figures: they are
made on your machine from the libraries named above, into lucid-assets, and
`models/assets/` -- where a clone of that lands by default -- is in
`.gitignore` with the rest of `models/`.

---

*This list is kept by hand — a check makes sure nothing installed is missing
from it, but not that a license named here is still the one upstream uses.
Where it matters to you, read theirs. It is what governs, whatever this page
says.*
