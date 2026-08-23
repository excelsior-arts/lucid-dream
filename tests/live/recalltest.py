"""Fresh session, empty context — can it answer purely from the memory file?"""
import asyncio, json, time
import websockets
async def main():
    async with websockets.connect("ws://127.0.0.1:6969/lucid-talk/ws", max_size=None) as ws:
        await ws.send(json.dumps({"cmd":"start"}))
        t0=time.monotonic(); asked=False; last=None
        while time.monotonic()-t0<600:
            m=json.loads(await ws.recv()); t=m.get("type")
            if t=="log" and "ready — just talk" in m["text"]:
                await ws.send(json.dumps({"cmd":"clear"})); await asyncio.sleep(0.5)
                await ws.send(json.dumps({"cmd":"say","text":"quick, what instrument am I learning and what's my dog called?"})); asked=True
            elif t=="assistant_done" and asked:
                last=m["text"]; break
        print("BRAND-NEW SESSION, nothing in context. Reply:")
        print("  ", last)
        low=(last or "").lower()
        print("  piano:", "piano" in low, "| rocket:", "rocket" in low)
        await ws.send(json.dumps({"cmd":"stop_all"})); await asyncio.sleep(2)
asyncio.run(main())
