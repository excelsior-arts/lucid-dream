# What this stands on

The [license](LICENSE) covers what was made here — the code, the writing, the
rooms and how they are drawn — and nothing else. Every piece below belongs to
whoever wrote it and is used under its own terms, none of which this project
can change and none of which changes this one.

Nothing here is committed that somebody else wrote. The Python packages are
installed from PyPI onto your machine by `setup.sh`, the models are downloaded
from Hugging Face into `models/`, the browser's packages are installed from npm
into `app/node_modules`, and all three are in `.gitignore`. What this
repository holds is the code, the personas and the rooms.

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
one thing that cannot be in this chain is copyleft.

| package | version | license | home |
| --- | --- | --- | --- |
| three | 0.185.1 | MIT, © three.js authors | https://threejs.org |
| @dimforge/rapier3d-compat | 0.20.0 | Apache-2.0, © Dimforge SAS | https://rapier.rs |
| react | 19.2.8 | MIT, © Meta Platforms, Inc. | https://react.dev |
| react-dom | 19.2.8 | MIT, © Meta Platforms, Inc. | https://react.dev |
| react-router | 8.3.1 | MIT, © React Training LLC / Remix Software | https://reactrouter.com |
| zustand | 5.0.15 | MIT, © Paul Henschel | https://github.com/pmndrs/zustand |

What builds and checks the page — Vite, TypeScript, Vitest, Playwright, ESLint,
and their own dependencies — is installed the same way and is in
nothing that is served, so it is not listed here; `app/package.json` — the
workspace root, where the tooling belongs — names it all, and `npm ls` will say
what your machine actually installed.

## In the repository

| what | where | license |
| --- | --- | --- |
| PolyForm Noncommercial 1.0.0 | `LICENSE` | the license text itself, from polyformproject.org |

Everything else under `machine/`, `app/`, `tools/` and `tests/` — including the
personas and the rooms — was written for this project and is covered by
[LICENSE](LICENSE). The voices are not in the repository at all: a reference
clip is fetched by `setup.sh` into `models/voices/` from the dataset named
above, and never committed.

---

*This list is kept by hand — a check makes sure nothing installed is missing
from it, but not that a license named here is still the one upstream uses.
Where it matters to you, read theirs. It is what governs, whatever this page
says.*
