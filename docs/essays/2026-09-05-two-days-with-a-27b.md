# Two days of asking a 27B to be a level designer

*A failure résumé from a real-time AI game, for anyone about to try the same thing.*

I am building a small game where a local language model is supposed to make the world as you walk through it. You walk across a desert. A voice narrates. The ground ahead is invented as you go, standing things appear on the horizon, and a question is asked of you now and then whose answer becomes a thing you can dash at and break. Everything runs on one Mac: a 27B model, a voice, a recognizer, a three.js scene, sixty steps a second.

Two days ago the model drew the ground and the stones. Today it does neither, and the game is better for it. Here is what happened, with the numbers that changed my mind. An AI coding agent did most of the typing and the measuring. The decisions were mine, and so were the wrong ones.

## The setup that seemed reasonable

The plan was a ladder of languages. At the bottom, the model fills a form: a name for this stretch of ground, a base out of five kinds, some numbers, a few features. Above that, a height formula in a tiny expression language. For the standing things, parts in a form, then a lathe profile, an extruded outline, and at the top a signed distance field in a GLSL subset that we compile and march into a mesh. Every rung was bounded, parsed, never executed. A stronger model would climb higher without a rewrite. It was a tidy idea and I still like it.

## What the logs said

After a day of walks I pulled the machine's log, which keeps counts and timings and never a word of conversation.

| | |
| --- | --- |
| seconds walked | 7 666 |
| seconds the model spent drawing ground and stones | 7 555 |
| ground and stone asks | 231 |
| of those, thrown away because I had walked past | 49 |
| stones with a model-written distance field, in two days | 4 |
| of those, in a region I actually entered | 0 |

The model was generating for almost every second I walked. That mattered more than I expected, because the model and the renderer share one GPU. Full screen on the large model I got 30 to 40 frames a second. Meanwhile the renderer's own cost was 111 draw calls and 136 000 triangles a frame, which is nothing. The frame rate ceiling was the language model, and every region it drew that I never reached was frames taken from the one thing the game is about, which is a fast, long dash.

And the drawing was not good. The ground specs the model wrote looked exactly like the ones drawn from keyed chance, because both go through the same five bases and the same compiler. The formulas were rejected half the time for climbing three metres in two. The stones came back as columns and slabs, which the fallback drew as well. The one rung that could have drawn something interesting, the distance field, landed four times in two days, and the reader refused most attempts for reasons like `sdCone wants a vec2` and `"[" is not part of a distance function`.

A 27B general model is a text generator. Asked to draw geometry token by token it is slow, wrong often, and dull when right. Where I wanted it to shine, it failed measurably. Where it did not matter, it cost most of the GPU. As I put it in the moment: little gain in using an interstellar rocket to nail a trim to the window.

## The narrator failed differently

The voice had the opposite problem. It worked, and it was insufferable. Every ember taken, every new stretch of ground, every twenty seconds of quiet became a line. "You are still standing on the broken ground." Every five seconds. Not the model's fault. I was handing it observations and it was observing them back at me.

## What we changed

**The ground is code.** Regions are keyed the moment they are needed. Nothing the model does touches what is under your feet.

**Names are the model's.** What it is good at is words. It is asked what a stretch is called and one line about it, and the same for the standing thing due there, six regions to a call. A batch of six names takes a few seconds where a region alone took up to forty-six.

**Stones are grown by a grammar.** Ten forms with keyed variation: stacks, split slabs, a leaning column, a ring, a bundle of shards, a gate, a shell, a spindle, a wave, a knot. The word the story currently stands as picks the form. Door grows a gate, key a spindle, bell a shell. A stone costs the model nothing. A yes is an open form with a way through it; a no is a solid one that stands in the way, because the game needs a no you can hit.

**The ask is a cone, not a ring.** We used to ask for a square of forty-eight regions around the figure. A dash is fast and straight, so now the model is asked about the ground ahead, deeper the faster you go, one region wide either side, nothing behind. The queue went from 31 waiting to 1.

**The narrator counts instead of narrating.** Embers and dashes are tallied and ride on the next real line as one clause. A new stretch waits out a minute of quiet. The silence timer restarts while you play, so "are you still there" only comes when nothing is happening.

**The story is the model's.** In the background it writes a script for the walk: a title, a few beats each waiting for a cue, one question, an ending. That block sits in the narrator's prompt and the beats advance on the walk's own events. The question you are asked is the script's. This is the part where the 27B earns its place.

## What I believe now

- Measure the model's time against the player's time. If they are equal, the model is your frame rate.
- Ask a language model for language. Names, lines, a script, a lean. Ask code for geometry.
- Fallbacks that look the same as the model's output are telling you something about the model's output.
- The player's speed is a design input. Whatever you compute ahead of the player, compute it where they are going.
- A voice that speaks every twenty seconds is off within five minutes. Count events, do not read them out.
- Serialize your model server. Two generations on one model at once stalled a line at three words for a quarter of a minute.

## What is next

Geometry from a model is not dead, it was the wrong model. Specialized image-to-3D networks exist now for Apple Silicon, and a lab study is running as I write this: a word becomes a picture with a small diffusion model, the picture becomes a mesh, and the mesh is judged against the grammar's stone for the same word, side by side, with seconds and gigabytes beside each. If a themed stone can be made in the background in under a minute and cached, it goes behind the grammar as a slow upgrade. If not, the grammar is the game, and that is fine.

The repository is Lucid Dream. The walk is Lucid Trip. Everything runs locally, and the logs that told me all this never contain a line of what anyone said.
