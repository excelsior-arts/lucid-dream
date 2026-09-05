"""The models, by the repositories they are checked out from.

The rule the shelf keeps: everything under the models directory is a checkout
of a published repository, at `<models>/<org>/<repo>`, exactly as published
and never changed. Which repository plays which part -- the language model in
its three sizes, the ear, the voice -- is written in models.json beside this
file, with the commit each is pinned to. That file is the machine's, and it is
the only thing a newer release of the game has to edit to bring a newer model
with it: setup fetches what is missing or at another commit, and what nothing
names any more is offered for pruning.

Nothing here reads the config: the config reads this. Where the shelf is --
`models` beside the code unless somebody keeps it elsewhere -- is handed in.
The one exception is the command line at the bottom, which is setup's tool
and asks the config which checkouts it names as sizes of its own, so that
those are never called strays.

    python -m machine.shelf --check              what is here, what is not
    python -m machine.shelf --fetch --sizes md,lg  bring it up to date
    python -m machine.shelf --prune              remove what nothing names
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "models.json"

ROLES = ("stt", "tts")          # one each; the language model comes in sizes


def manifest() -> dict:
    return json.loads(MANIFEST.read_text())


def sizes() -> list[str]:
    """The sizes the language model comes in, smallest first, as shipped."""
    return list(manifest()["llm"])


def entry(role: str, size: str | None = None) -> dict:
    """One line of the manifest: the repository, its commit, its weight."""
    m = manifest()
    return m["llm"][size] if role == "llm" else m[role]


def where(base: str | Path, role: str, size: str | None = None) -> Path:
    """The directory a role's checkout is in, under `base`."""
    return Path(base) / entry(role, size)["repo"]


def entries(only_sizes: list[str] | None = None) -> list[tuple[str, dict]]:
    """Every checkout the manifest asks for, labelled the way setup prints
    them: `llm/lg`, `stt`, `tts`. Sizes not asked for are left out."""
    m = manifest()
    out = [(f"llm/{s}", e) for s, e in m["llm"].items()
           if only_sizes is None or s in only_sizes]
    out += [(role, m[role]) for role in ROLES]
    return out


# ---- whether a checkout is all there ----------------------------------------

def commit(home: Path) -> str:
    """The commit a checkout is at, from the downloader's own bookkeeping.

    huggingface_hub writes a `.metadata` beside each file it fetched, under
    `.cache/huggingface/download` at the directory it was pointed at; the
    first line is the commit. config.json is the file every model has.
    """
    for name in ("config.json", "model.safetensors.index.json", "README.md"):
        meta = home / ".cache" / "huggingface" / "download" / f"{name}.metadata"
        if meta.is_file():
            try:
                return meta.read_text().splitlines()[0].strip()
            except (OSError, IndexError):
                return ""
    return ""


def state(home: Path, rev: str = "") -> str:
    """One of `whole`, `outdated`, `half`, `missing`.

    "Some file in here ends in .safetensors" was the old answer, and it was
    true of a download interrupted at the third shard of nine: every later run
    skipped it as installed, and the first anybody heard of it was MLX
    refusing to load, hours later. What is asked instead is what the loader
    itself asks -- the weight index names its shards, and every one of them
    has to be here, with the config and the tokenizer beside them. And then
    the commit: a whole checkout of the wrong revision is `outdated`, which is
    what a newer release of the game finds on a Mac that installed the last
    one.

    The `.incomplete` files under the downloader's own scratch are not asked
    about. They used to be: a file the downloader had not finished was a
    download to run again. But a file is only ever put in place once it is
    finished -- it is written elsewhere and moved -- so a shard that is here
    is whole, and the client that reconstructs files from chunks leaves an
    `.incomplete` behind when a resumed download supersedes an earlier
    attempt. Measured: a complete 4B, at the pinned commit, called half by a
    half-gigabyte leftover, and setup stopping on it. fetch() clears them.
    """
    if not home.is_dir():
        return "missing"
    index = home / "model.safetensors.index.json"
    if index.is_file():
        try:
            shards = set(json.loads(index.read_text())["weight_map"].values())
        except Exception:
            return "half"                # the index itself arrived half-written
    else:
        shards = {p.name for p in home.glob("*.safetensors")}
    here = bool(shards) and all((home / name).is_file() for name in shards)
    # What the weights are useless without: what shape the model is, and how
    # it turns words into numbers. The second is named loosely because every
    # family spells it differently -- tokenizer.json, tokenizer.model, vocab.txt.
    told = (home / "config.json").is_file() and any(
        any(home.glob(kind)) for kind in
        ("tokenizer*", "vocab*", "merges.txt", "spiece*", "*.model"))
    if not (here and told):
        return "half"
    if rev and (at := commit(home)) and at != rev:
        return "outdated"
    return "whole"


def whole(home: Path, rev: str = "") -> bool:
    return state(home, rev) == "whole"


# ---- what is on the shelf that nothing asks for -----------------------------

def strays(base: str | Path, keep: list[Path] | None = None) -> list[Path]:
    """Checkouts under the shelf that no line of the manifest names.

    Two levels down, the way checkouts are laid out: `<org>/<repo>`. A
    checkout the caller wants kept -- one the config names as a size of its
    own -- is not a stray, nor is anything above it. The voices are a
    checkout of their own with a home of their own -- see machine/voices.py
    -- and anything at the top level that is not a directory of checkouts is
    left alone with them.
    """
    base = Path(base)
    if not base.is_dir():
        return []
    named = {where(base, "llm", s).resolve() for s in sizes()}
    named |= {where(base, r).resolve() for r in ROLES}
    kept = [Path(k).resolve() for k in (keep or [])]
    out = []
    for org in sorted(base.iterdir()):
        if org.name.startswith(".") or not org.is_dir() or org.name == "voices":
            continue
        for repo in sorted(org.iterdir()):
            if not repo.is_dir() or repo.name.startswith("."):
                continue
            home = repo.resolve()
            if home in named or any(k == home or k.is_relative_to(home) for k in kept):
                continue
            out.append(repo)
    return out


def size_of(path: Path) -> float:
    """Gigabytes on disk."""
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file()) / 1e9


# ---- fetching ---------------------------------------------------------------

def fetch(base: str | Path, role: str, size: str | None = None) -> Path:
    """Bring one checkout to the commit the manifest pins. Resumes a download
    that stopped, and does nothing to one already there."""
    from huggingface_hub import snapshot_download
    e = entry(role, size)
    home = where(base, role, size)
    home.parent.mkdir(parents=True, exist_ok=True)
    snapshot_download(e["repo"], revision=e["rev"], local_dir=str(home))
    if whole(home, e["rev"]):
        tidy(home)
    return home


def tidy(home: Path) -> int:
    """Remove what the downloader left in its scratch under a whole checkout:
    the `.incomplete` of an attempt a later one superseded. Its bookkeeping
    stays -- that is where the commit is read from. Returns bytes freed."""
    freed = 0
    for p in (home / ".cache" / "huggingface" / "download").rglob("*.incomplete"):
        freed += p.stat().st_size
        p.unlink()
    return freed


# ---- the command line, for setup.sh -----------------------------------------

def _say(label: str, what: str) -> None:
    print(f"  {label:22} {what}", flush=True)


def main(argv: list[str]) -> int:
    import argparse
    ap = argparse.ArgumentParser(description="the models, as the manifest has them")
    ap.add_argument("--models", default="models", help="the shelf (default: models/ beside the code)")
    ap.add_argument("--sizes", default=",".join(sizes()),
                    help="which sizes of the language model (default: all)")
    ap.add_argument("--check", action="store_true", help="say what is missing and change nothing")
    ap.add_argument("--fetch", action="store_true", help="download what is missing or outdated")
    ap.add_argument("--prune", action="store_true", help="remove checkouts nothing names")
    a = ap.parse_args(argv)
    base = Path(a.models).expanduser()
    if not base.is_absolute():
        base = HERE.parent / base
    asked = [s for s in a.sizes.split(",") if s]
    unknown = [s for s in asked if s not in sizes()]
    if unknown:
        print(f"no such size: {', '.join(unknown)} — the sizes are {', '.join(sizes())}")
        return 2

    failed = False
    for label, e in entries(asked):
        home = base / e["repo"]
        how = state(home, e["rev"])
        if how == "whole":
            _say(label, "already here")
            continue
        if a.check or not a.fetch:
            _say(label, {"missing": f"would download ~{e['gb']} GB",
                         "half": "half here — would finish the download",
                         "outdated": f"a newer one is pinned — would download ~{e['gb']} GB"}[how])
            continue
        _say(label, {"missing": f"downloading ~{e['gb']} GB",
                     "half": "picking up where it stopped",
                     "outdated": f"a newer one is pinned — downloading ~{e['gb']} GB"}[how])
        try:
            fetch(base, *label.split("/")) if label.startswith("llm/") else fetch(base, label)
        except Exception as err:
            _say(label, f"did not finish — {type(err).__name__}: {err}")
            failed = True
            continue
        if not whole(home, e["rev"]):
            _say(label, "still not whole after the download")
            failed = True

    # What the config names as a size of its own is somebody's on purpose.
    try:
        from . import config as C
        keep = [C.somewhere(str(v)) for v in ((C.written().get("llm") or {}).get("sizes") or {}).values()]
    except Exception:
        keep = []
    old = strays(base, keep)
    if old:
        for p in old:
            gb = size_of(p)
            if a.prune and not a.check:
                shutil.rmtree(p)
                _say(f"{p.parent.name}/{p.name}", f"removed, {gb:.1f} GB freed")
            else:
                _say(f"{p.parent.name}/{p.name}", f"nothing uses this — {gb:.1f} GB; --prune removes it")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
