"""End-to-end walkthrough: one full night across all four roles, driven in a real browser.

Follows the README's judge walkthrough. Set BASE (default http://localhost:3100) and optionally
RECORD=1 to save a video in ./rec, PACE to slow it down for a demo recording.
Fails with an exception if any step can't be completed.
"""
import os
import asyncio
import re
from playwright.async_api import async_playwright

BASE = os.environ.get("BASE", "http://localhost:3100")
W, H = 1440, 810  # 16:9 viewport
PACE = float(os.environ.get("PACE", "0.15"))  # 1.25 for a ~5 minute recording


async def pause(s):
    await asyncio.sleep(s * PACE)


async def smooth_to(loc):
    await loc.evaluate("e => e.scrollIntoView({block: 'center', behavior: 'smooth'})")
    await asyncio.sleep(0.9)


async def click(loc, after=2.0):
    await smooth_to(loc)
    await loc.click()
    await pause(after)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome")
        rec = dict(record_video_dir="rec", record_video_size={"width": W, "height": H}) if os.environ.get("RECORD") else {}
        ctx = await browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1, **rec)
        # A fresh demo day, and the four seeded accounts signed in on this browser.
        await ctx.request.post(BASE + "/api/day/new")
        for user in ["gehiru.dispatch", "senash.kandydock", "nimsith.veh041", "malika.out029"]:
            r = await ctx.request.post(BASE + "/api/auth/login", data={"username": user, "password": "routelanka"})
            assert r.ok, await r.text()
        page = await ctx.new_page()

        # ---- Part 2: the planner --------------------------------------------------
        await page.goto(BASE + "/")
        await pause(5)
        await click(page.get_by_role("button", name=re.compile(r"^Dispatcher")), 10)
        await click(page.get_by_role("link", name="Plan board", exact=True), 5)
        await click(page.get_by_role("button").filter(has_text="OUT070").last, 8)
        await page.evaluate("window.scrollTo({top: 0, behavior: 'smooth'})")
        await asyncio.sleep(1)
        await click(page.get_by_role("button", name="Publish plan"), 5)

        # ---- Part 3: the shop on WhatsApp -------------------------------------------
        await page.goto(BASE + "/preview?path=%2Fstore%2Fmessages")
        phone = page.frame_locator("iframe")
        await pause(3)
        noted = phone.get_by_role("button", name="Noted, thanks")
        await smooth_to(noted)
        await pause(3)
        lang = phone.locator("button[aria-label^='Language']")
        # Each tap waits for the change to be saved and shown (on a deployed server that takes a round trip).
        await lang.click()          # Sinhala
        await phone.locator("button[aria-label^='Language: සිංහල']").wait_for()
        await pause(6)
        await lang.click()          # Tamil
        await phone.locator("button[aria-label^='Language: தமிழ்']").wait_for()
        await asyncio.sleep(0.4)
        await lang.click()          # back to English
        await phone.locator("button[aria-label^='Language: English']").wait_for()
        await pause(2)
        await click(noted, 5)

        # ---- Part 4: the warehouse ----------------------------------------------------
        await page.goto(BASE + "/dock")
        await pause(4)
        await page.goto(BASE + "/dock/VEH041/1")
        await pause(3)
        load = page.get_by_role("button", name="Load", exact=True)
        await click(load.first, 2)
        await click(load.first, 2)
        await click(page.get_by_role("button", name="Flag a problem with OUT107").nth(1), 2)
        plus = page.locator("button").filter(has_text=re.compile(r"^\s*\+\s*$"))
        for _ in range(3):
            await plus.click()
            await asyncio.sleep(0.5)
        await pause(1.5)
        await click(page.get_by_role("button", name="Send to dispatcher"), 4)

        await page.goto(BASE + "/dispatch/monitor")
        await pause(5)
        await click(page.get_by_role("button").filter(has_text="Send short"), 4)

        await page.goto(BASE + "/dock/VEH041/1")
        # Wait for the loading list, then load each remaining line, waiting for each tap to be saved.
        await page.get_by_label(re.compile(r"^Load position 1 of")).wait_for(timeout=30000)
        await pause(2)
        while (n := await load.count()):
            await click(load.first, 1.5)
            for _ in range(40):
                if await load.count() < n:
                    break
                await asyncio.sleep(0.25)
        # Mark ready appears once the server has confirmed every line (a round trip each on a deployed server).
        ready = page.get_by_role("button").filter(has_text="Mark ready")
        await ready.wait_for(timeout=30000)
        await click(ready, 2.5)
        await click(page.get_by_role("button").filter(has_text="Release"), 5)

        # ---- Part 5: the driver, no signal ----------------------------------------------
        await page.goto(BASE + "/preview")
        phone = page.frame_locator("iframe")
        await pause(6)
        await click(phone.get_by_role("button", name="Lose signal"), 2)
        await phone.locator("body").evaluate("() => window.scrollTo({top: 0, behavior: 'smooth'})")
        await pause(4)
        await click(phone.locator("a,button").filter(has_text="Start this stop").first, 3)
        await click(phone.get_by_role("button", name="I've arrived"), 3)
        # The driver asks the store for its handover code (the store sees it on WhatsApp).
        sv = await (await ctx.request.get(BASE + "/api/view", headers={"x-rl-role": "store"})).json()
        ref108 = next(o["order_ref"] for o in sv["orders"] if o.get("vehicle_id") == "VEH041" and o.get("trip_id") == 1 and o["outlet_id"] == "OUT108")
        code = phone.locator("input").last
        await smooth_to(code)
        await code.press_sequentially(sv["codes"][ref108], delay=350)
        await pause(3)
        await click(phone.get_by_role("button").filter(has_text="Save delivery"), 4)
        await click(phone.get_by_role("button", name="Held up? Report a delay"), 4)
        await click(phone.get_by_role("button", name="Send to dispatcher"), 2)
        await phone.locator("body").evaluate("() => window.scrollTo({top: 0, behavior: 'smooth'})")
        await pause(5)

        # ---- Part 6: the planner decides, the shop replies -------------------------------
        await page.goto(BASE + "/dispatch/map")
        await pause(10)
        await page.goto(BASE + "/dispatch/monitor")
        await pause(4)
        confirm = page.get_by_role("button", name="Confirm and tell the stores")
        await smooth_to(confirm)
        await pause(5)
        await click(confirm, 5)

        await page.goto(BASE + "/preview?path=%2Fstore%2Fmessages%3Foutlet%3DOUT104")
        phone = page.frame_locator("iframe")
        await pause(3)
        wait_btn = phone.get_by_role("button", name="We'll wait")
        await smooth_to(wait_btn)
        await pause(4)
        await click(wait_btn, 5)

        # ---- Part 7: signal comes back -------------------------------------------------
        await page.goto(BASE + "/preview")
        phone = page.frame_locator("iframe")
        await pause(3)
        await click(phone.get_by_role("button", name="Signal returns"), 1)
        await phone.locator("body").evaluate("() => window.scrollTo({top: 0, behavior: 'smooth'})")
        await pause(6)
        understood = phone.get_by_role("button", name="Understood")
        for _ in range(3):
            if not await understood.count():
                break
            await smooth_to(understood.first)
            await pause(2.5)
            await understood.first.click()
            await pause(1.5)
        await phone.get_by_text("All stops", exact=True).evaluate("e => e.scrollIntoView({block: 'start', behavior: 'smooth'})")
        await pause(7)

        # closing shot: the map, truck at its real last report
        await page.goto(BASE + "/dispatch/map")
        await pause(9)

        # ---- check the outcome through the API ----------------------------------------
        v = await (await ctx.request.get(BASE + "/api/view", headers={"x-rl-role": "dispatcher"})).json()
        st = v["states"]
        first = next(o for o in v["orders"] if o.get("vehicle_id") == "VEH041" and o.get("trip_id") == 1 and o["outlet_id"] == "OUT108")
        assert st[first["order_ref"]]["stage"] == "delivered", st[first["order_ref"]]
        assert st[first["order_ref"]].get("recordedOffline"), "delivery should be recorded offline"
        assert v["driver"]["online"] and v["driver"]["lastSync"]["delivered"] == 1, v["driver"]
        assert any(r["reply"] == "wait" for r in v["storeReplies"].values()), v["storeReplies"]
        assert v["delayToldAt"], "dispatcher should have decided the held-up stops"
        print("PASS: full night completed;", len(v["feed"]), "events in the feed")
        video_path = await page.video.path() if page.video else None
        await ctx.close()
        await browser.close()
        if video_path:
            print("video:", video_path)


asyncio.run(main())
