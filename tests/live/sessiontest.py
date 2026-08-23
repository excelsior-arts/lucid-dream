import asyncio, json, time
import websockets

async def main():
    async with websockets.connect("ws://127.0.0.1:6969/lucid-talk/ws", max_size=None) as ws:
        state={"sid":None,"replies":0,"personas":[],"sessions":[]}
        async def until(pred, limit=420):
            t0=time.monotonic()
            while time.monotonic()-t0<limit:
                m=json.loads(await ws.recv())
                if m.get("type")=="tick": state["sid"]=m.get("session_id"); state["persona"]=m.get("persona")
                elif m.get("type")=="personas": state["personas"]=[x["slug"] for x in m["items"]]
                elif m.get("type")=="sessions": state["sessions"]=m["items"]
                elif m.get("type")=="log": print("   log:", m["text"], flush=True)
                elif m.get("type")=="assistant_done":
                    state["replies"]+=1; print("   reply:", m["text"][:70], flush=True)
                elif m.get("type")=="history": state["hist"]=m["messages"]
                if pred(m): return m
            raise TimeoutError("gave up")

        print("1) start"); await ws.send(json.dumps({"cmd":"start"}))
        await until(lambda m: m.get("type")=="log" and "ready — just talk" in m["text"])
        print("   personas:", state["personas"], "| active:", state.get("persona"))
        first_sid = state["sid"]; print("   session:", first_sid)

        print("2) two turns")
        await ws.send(json.dumps({"cmd":"say","text":"remember this word: pineapple."}))
        await until(lambda m: m.get("type")=="assistant_done")
        await ws.send(json.dumps({"cmd":"say","text":"what word did I ask you to remember?"}))
        await until(lambda m: m.get("type")=="assistant_done")

        print("3) switch persona to thinker (new voice + new session)")
        await ws.send(json.dumps({"cmd":"open","slug":"thinker"}))
        await until(lambda m: m.get("type")=="log" and m["text"].startswith("voice:"))
        await ws.send(json.dumps({"cmd":"say","text":"say hello in your own style."}))
        await until(lambda m: m.get("type")=="assistant_done")
        second_sid=state["sid"]; print("   new session:", second_sid)

        print("4) list sessions"); await ws.send(json.dumps({"cmd":"sessions"}))
        await until(lambda m: m.get("type")=="sessions")
        for x in state["sessions"][:4]: print(f"   {x['id']}  {x['persona_name']:10s} {x['turns']} turns  {x['preview'][:40]}")

        print("5) resume the first session and check it remembers")
        await ws.send(json.dumps({"cmd":"open","session":first_sid}))
        await until(lambda m: m.get("type")=="history")
        print("   restored turns:", len(state["hist"]))
        await ws.send(json.dumps({"cmd":"say","text":"so what was that word again?"}))
        m=await until(lambda m: m.get("type")=="assistant_done")
        print("   RECALL:", m["text"])
        print("   -> remembered:", "pineapple" in m["text"].lower())

        await ws.send(json.dumps({"cmd":"stop_all"})); await asyncio.sleep(3)
asyncio.run(main())
