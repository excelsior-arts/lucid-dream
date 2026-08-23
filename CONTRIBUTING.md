# Contributing

Lucid Dream is a work of art that happens to be software, and that is what
decides where a patch belongs. The games on this shelf are authored — the
people you meet in them, the places you meet them in, the writing and the look
of the whole thing. There will be more games, and they will arrive the same
way: made rather than assembled. None of that is an unfinished edge in want of
a plugin API. It is the thing itself.

The engineering underneath is a different matter, and it is real engineering:
four models kept in step on one machine, a game drawn in CSS rather than WebGL
so that its words stay words, and a memory budget that has to hold all of it
and still answer before you lose the thread. There the door is open, and help is
genuinely wanted.

## What travels well

**Wanted — the machine, not the art:**

- **Ports.** It is Apple Silicon and MLX today because that is the machine it
  was written on, not because anyone decided the rest of the world should not
  have it. A patch that makes it run on Linux, or on another accelerator, is
  the contribution this project would most like to receive.
- **The models and their plumbing.** A different language-model server, a
  recognizer or a voice that is better company, a fix to how any of them are
  spoken to. Something that makes the evening twice as good for the same
  hardware is worth more here than any amount of new surface.
- **Anything simply broken.** A crash, a wrong number in the documentation, a
  setup step that fails on a machine unlike mine, a browser that draws the box
  wrong.
- **Performance**, in the models or in the game.

**Ask first, in an issue rather than a pull request:** new dependencies,
anything that changes how it looks or what it says, and anything large enough
that you would be sorry to have it turned down.

**Not accepted:** the authored layer — new games, new personas, new places to
meet them, new voices, and changes to the visual design or to the writing. That
layer is one person's and stays that way, however many games there come to be.
Beyond taste, there is a reason to be strict about it: a substantial creative
contribution to a work of authorship raises questions of joint authorship that
a bug fix never does, and those are not the kind of question you want to
discover years later. The license already lets you keep a persona of your own
in your own copy, for anything noncommercial; see **[MANUAL.md](MANUAL.md)**.
It is simply not coming back upstream, and that is no judgement of it.

Two things travel with every patch that is accepted, and both exist for the
same reason: this project may one day need to be licensed on other terms, and
that is only possible if the rights to every line in it are clear.
Sorting that out afterwards means finding everybody who ever sent a patch and
asking their permission — which is how projects end up unable to change their
own license.

## Signing off

Every commit carries a `Signed-off-by` line:

```sh
git commit -s -m "what it does"
```

That line is the [Developer Certificate of Origin](https://developercertificate.org)
1.1: you are stating that the work is yours to give, or that you have the right
to pass it on under this project's license.

## And the grant that goes with it

By sending a contribution — a pull request, a patch, a suggested edit — you
agree that:

1. It is licensed to the project under **[PolyForm Noncommercial
   1.0.0](LICENSE)**, the same terms as everything around it.

2. You additionally grant **Eugene Tiutiunnyk, and his successors and
   assigns**, a perpetual, worldwide, irrevocable, royalty-free, non-exclusive,
   **sublicensable** license to use, modify and **relicense** your contribution
   under any terms, including commercial ones — so the project can be
   dual-licensed, or offered as a hosted service, without coming back to you.
   *Successors and assigns* is there because a license granted to a person does
   not automatically follow the work into a company formed later, and this is
   cheap to say now and impossible to fix afterwards.

3. If you hold patent rights that your contribution would otherwise infringe,
   you grant the same people a license to those, on the same terms, for this
   project and whatever it becomes.

4. You keep your own copyright. Nothing here assigns it, and you may go on
   using your own work however you like.

Point 2 is the whole of it. Everything else follows the license.

## The rest

- `./check.sh` before every commit. The fast tier needs nothing installed; the
  rooms tier wants a browser and a running server, and says so if it cannot
  run — see **[AGENTS.md](AGENTS.md)**, *The checks*.
- **US English**, in the writing and in the names of things.
- Comments say **why**, not what, and never what things used to be. The files
  here are their own documentation; match the voice of what you are editing.
- Nothing private goes beside the code. It belongs under `userdata/` — see
  `shell/paths.py`, which explains why that guarantee is one line in
  `.gitignore` rather than a list somebody has to remember to extend.

*This file is not legal advice. If you are contributing on behalf of an
employer, check that you may.*
