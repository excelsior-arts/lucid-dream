import asyncio, json, time
import websockets
TURNS = [
 "My name is Sam and I repair church organs for a living.",
 "I have a dog called Rocket, he's a beagle.",
 "I'm learning to play the piano lately, mostly jazz.",
 "The weather has been gray all week.",
 "I might go to Iceland in the spring.",
 "Anyway, what's your favorite kind of music?",
 "Do you remember my dog's name, and what instrument I'm learning?",
]
async def main():
    async with websockets.connect("ws://127.0.0.1:6969/lucid-talk/ws", max_size=None) as ws:
        await ws.send(json.dumps({"cmd":"open","slug":"lover"})); await asyncio.sleep(1)
        await ws.send(json.dumps({"cmd":"start"}))
        i=0; t0=time.monotonic(); last=None
        while time.monotonic()-t0<900:
            m=json.loads(await ws.recv()); t=m.get("type")
            if t=="log":
                if "memory updated" in m["text"] or "fold failed" in m["text"]: print("  *",m["text"],flush=True)
                if "ready — just talk" in m["text"]:
                    await ws.send(json.dumps({"cmd":"say","text":TURNS[0]})); i=1
            elif t=="assistant_done":
                last=m["text"]; print(f"  {i}. {m['text'][:80]}",flush=True)
                if i<len(TURNS):
                    await asyncio.sleep(1.0)
                    await ws.send(json.dumps({"cmd":"say","text":TURNS[i]})); i+=1
                else: break
        print("\nFINAL RECALL:", last)
        low=(last or "").lower()
        print("remembered dog:", "rocket" in low, "| remembered piano:", "piano" in low)
        await ws.send(json.dumps({"cmd":"stop_all"})); await asyncio.sleep(2)
asyncio.run(main())
