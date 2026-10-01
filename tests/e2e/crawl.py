"""Visits every screen at desktop and phone size and reports anything broken.

For each page it records: uncaught page errors, console errors, failed API calls (HTTP 4xx/5xx or network
failure), Next.js error screens, and horizontal scrolling on a phone (the brief judges driver and store
screens on phones). Exit code 1 if anything is found.

Map tiles that Leaflet cancels while it fits the view (ERR_ABORTED) are normal and ignored.

    BASE=http://localhost:3000 python tests/e2e/crawl.py            # SHOTS=dir to also save screenshots
"""
import asyncio
import os
import sys

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE", "http://localhost:3100")
SHOTS = os.environ.get("SHOTS")
ACCOUNTS = ["gehiru.dispatch", "senash.kandydock", "nimsith.veh041", "malika.out029"]
SIZES = {"desktop": (1440, 900), "phone": (390, 844)}


async def main():
    problems = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome")
        ctx = await browser.new_context()
        # Signed out: protected screens must send you to sign-in, not crash.
        page = await ctx.new_page()
        await page.goto(BASE + "/dispatch/plan")
        await page.wait_for_load_state("networkidle")
        if "/login" not in page.url:
            problems.append(f"signed out: /dispatch/plan did not redirect to sign-in (at {page.url})")
        await page.close()

        await ctx.request.post(BASE + "/api/day/new")
        for u in ACCOUNTS:
            r = await ctx.request.post(BASE + "/api/auth/login", data={"username": u, "password": "routelanka"})
            assert r.ok, await r.text()
        await ctx.request.post(BASE + "/api/commands", data={"type": "publish"}, headers={"x-rl-role": "dispatcher"})
        v = await (await ctx.request.get(BASE + "/api/view", headers={"x-rl-role": "driver"})).json()
        drv = v["driver"]
        stop = next(o["order_ref"] for o in v["orders"] if o.get("vehicle_id") == drv["vehicle_id"] and o.get("trip_id") == drv["trip_id"])
        routes = ["/", "/login", "/guide", "/styleguide", "/preview",
                  "/dispatch", "/dispatch/plan", "/dispatch/monitor", "/dispatch/map", "/dispatch/fleet", "/dispatch/outlook", "/dispatch/impact", "/dispatch/whatsapp", "/wa-sim",
                  "/dock", f"/dock/{drv['vehicle_id']}/{drv['trip_id']}",
                  "/driver", f"/driver/stop/{stop}",
                  "/store", "/store/messages", "/store/order", f"/store/receive/{stop}"]

        for size, (w, h) in SIZES.items():
            for route in routes:
                page = await ctx.new_page()
                await page.set_viewport_size({"width": w, "height": h})
                found = []
                page.on("pageerror", lambda e, f=found: f.append(f"page error: {e}"))
                page.on("console", lambda m, f=found: f.append(f"console {m.type}: {m.text[:200]}") if m.type == "error" else None)
                page.on("requestfailed", lambda r, f=found: f.append(f"request failed: {r.url} {r.failure}") if "/api/stream" not in r.url and "_rsc" not in r.url and not ("tile.openstreetmap.org" in r.url and "ERR_ABORTED" in str(r.failure)) else None)
                page.on("response", lambda r, f=found: f.append(f"HTTP {r.status} {r.request.method} {r.url}") if r.status >= 400 else None)
                try:
                    await page.goto(BASE + route, wait_until="networkidle", timeout=30000)
                except Exception as e:  # SSE keeps a connection open on some pages
                    if "Timeout" not in str(e):
                        found.append(f"navigation: {e}")
                await asyncio.sleep(1.5)
                body = await page.inner_text("body")
                if "Application error" in body or "Unhandled Runtime Error" in body or "This page could not be found" in body:
                    found.append("error screen: " + body[:160].replace("\n", " "))
                if size == "phone":
                    over = await page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
                    if over > 1:
                        found.append(f"scrolls sideways by {over}px on a phone")
                if SHOTS:
                    os.makedirs(SHOTS, exist_ok=True)
                    await page.screenshot(path=f"{SHOTS}/{size}{route.replace('/', '_') or '_root'}.jpg", type="jpeg", quality=55, full_page=True)
                for f in dict.fromkeys(found):
                    problems.append(f"[{size}] {route}: {f}")
                print(f"{'FAIL' if found else ' ok '} [{size}] {route}")
                await page.close()
        await browser.close()

    print(f"\n{len(problems)} problem(s)")
    for x in problems:
        print(" -", x)
    sys.exit(1 if problems else 0)


asyncio.run(main())
