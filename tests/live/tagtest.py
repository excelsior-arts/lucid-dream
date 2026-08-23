import asyncio, json, re, sys, time
import websockets
TURNS = ["hey, how are you doing today?",
         "I just got back from a really long walk.",
         "that reminds me, did you hear what happened at work?",
         "honestly I'm a bit tired of it all.",
         "anyway, tell me something interesting.",
         "haha that's actually pretty good."]
async def main():
    async with websockets.connect("ws://127.0.0.1:6969/lucid-talk/ws", max_size=None) as ws:
        await ws.send(json.dumps({"cmd":"start"}))
        replies=[]; i=0; t0=time.monotonic()
        while time.monotonic()-t0 < 600:
            m=json.loads(await ws.recv())
            if m.get("type")=="log" and "ready — just talk" in m["text"]:
                await ws.send(json.dumps({"cmd":"say","text":TURNS[0]})); i=1
            elif m.get("type")=="assistant_done":
                replies.append(m["text"])
                print(f"  {len(replies)}. {m['text']}", flush=True)
                if i < len(TURNS):
                    await asyncio.sleep(0.5)
                    await ws.send(json.dumps({"cmd":"say","text":TURNS[i]})); i+=1
                else: break
        tagged=[r for r in replies if re.search(r"\[[a-z-]+\]", r)]
        print(f"\nreplies with a tag: {len(tagged)}/{len(replies)}")
        print("tags used:", re.findall(r"\[[a-z-]+\]", " ".join(replies)))
        await ws.send(json.dumps({"cmd":"stop_all"})); await asyncio.sleep(3)
asyncio.run(main())
