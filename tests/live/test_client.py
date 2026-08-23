"""Drive the running app over its websocket, the way the UI does."""
import asyncio, json, sys, time
import websockets

async def main():
    t0 = time.monotonic()
    async with websockets.connect("ws://127.0.0.1:6969/lucid-talk/ws", max_size=None) as ws:
        await ws.send(json.dumps({"cmd": "start"}))
        said = False
        done = False
        last_state = None
        reply = ""
        while time.monotonic() - t0 < 900:
            try:
                m = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
            except asyncio.TimeoutError:
                print("[timeout waiting for message]"); break
            t = m.get("type")
            if t == "log":
                print(f"[{time.monotonic()-t0:6.1f}s] LOG {m['text']}", flush=True)
                if "ready — just talk" in m["text"] and not said:
                    said = True
                    print(">>> sending text turn", flush=True)
                    await ws.send(json.dumps({"cmd": "say", "text": "Hey. Say something short back to me."}))
            elif t == "state" and m["state"] != last_state:
                last_state = m["state"]
                print(f"[{time.monotonic()-t0:6.1f}s] STATE {m['state']}", flush=True)
            elif t == "tick" and int(time.monotonic()-t0) % 20 == 0:
                pass
            elif t == "assistant_delta":
                reply += m["text"]
            elif t == "assistant_done":
                print(f"[{time.monotonic()-t0:6.1f}s] REPLY: {m['text']!r}", flush=True)
                done = True
            elif t == "audio_out":
                print(f"[{time.monotonic()-t0:6.1f}s] AUDIO playing={m['playing']}", flush=True)
            if done and last_state == "idle":
                break
        # report memory then tear down
        await ws.send(json.dumps({"cmd": "stop_all"}))
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            m = json.loads(await ws.recv())
            if m.get("type") == "log":
                print(f"[stop] {m['text']}", flush=True)
                if "RAM released" in m["text"]:
                    break
            if m.get("type") == "tick":
                mem = m["memory"]
        await asyncio.sleep(1)
        print("DONE", flush=True)

asyncio.run(main())
