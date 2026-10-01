"""Exercises the paths the scripted walkthrough does not: plan edits with undo, re-planning, a store order,
real browser offline on the driver's phone (not the demo button), a wrong handover code, a receipt problem,
language switching, fleet actions and signing out. Fails on any uncaught page error, console error or
failed API call outside the deliberate offline period.

    BASE=http://localhost:3000 python tests/e2e/interactions.py
"""
import asyncio
import os
import re
import sys

from playwright.async_api import async_playwright, expect

BASE = os.environ.get("BASE", "http://localhost:3100")
ACCOUNTS = ["gehiru.dispatch", "senash.kandydock", "nimsith.veh041", "malika.out029"]
errors: list[str] = []
offline_now = False


def watch(page, tag):
    def bad(msg):
        if not offline_now:
            errors.append(f"{tag}: {msg}")
    page.on("pageerror", lambda e: bad(f"page error: {e}"))
    page.on("console", lambda m: bad(f"console: {m.text[:200]}") if m.type == "error" else None)
    page.on("response", lambda r: bad(f"HTTP {r.status} {r.request.method} {r.url}") if r.status >= 400 and "/api/" in r.url else None)


def ok(step):
    print("  ok ", step)


async def view(ctx, role):
    return await (await ctx.request.get(BASE + "/api/view", headers={"x-rl-role": role})).json()


async def main():
    global offline_now
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome")
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        await ctx.request.post(BASE + "/api/day/new")
        for u in ACCOUNTS:
            assert (await ctx.request.post(BASE + "/api/auth/login", data={"username": u, "password": "routelanka"})).ok

        # ---- Dispatcher: defer, undo, re-plan, publish --------------------------------------------------------
        page = await ctx.new_page()
        watch(page, "dispatcher")
        await page.goto(BASE + "/dispatch/plan")
        served_before = sum(o["decision"] == "served" for o in (await view(ctx, "dispatcher"))["orders"])
        await page.get_by_role("button").filter(has_text="OUT026").first.click()
        await page.get_by_role("button", name="Defer", exact=True).click()
        await expect(page.get_by_role("button", name="Undo")).to_be_visible()
        await page.wait_for_timeout(800)
        v = await view(ctx, "dispatcher")
        assert sum(o["decision"] == "served" for o in v["orders"]) == served_before - 1, "defer did not apply"
        await page.get_by_role("button", name="Undo").click()
        await page.wait_for_timeout(1000)
        assert sum(o["decision"] == "served" for o in (await view(ctx, "dispatcher"))["orders"]) == served_before, "undo did not restore"
        ok("plan board: defer and undo")

        await page.get_by_role("button", name="Re-plan").click()
        await expect(page.get_by_text(re.compile(r"Last planner run: \d+ served"))).to_be_visible(timeout=20000)
        ok("re-plan: engine job ran over RabbitMQ and the board updated live")
        await page.get_by_role("button", name="Publish plan").click()
        await expect(page.get_by_text(re.compile(r"Published · version"))).to_be_visible()
        ok("published")

        await page.goto(BASE + "/dispatch/fleet")
        await page.get_by_role("button", name="Ask workshop").first.click()
        await expect(page.get_by_text("Workshop asked").first).to_be_visible()
        await page.get_by_role("button", name="Request a hired truck").click()
        await page.wait_for_timeout(800)
        assert (await view(ctx, "dispatcher"))["fleet"]["repairs"], "repair request not recorded"
        ok("fleet: ask workshop, request a hired truck")

        # ---- Store (phone): place an order, switch language ----------------------------------------------------
        phone = await ctx.new_page()
        watch(phone, "store")
        await phone.set_viewport_size({"width": 390, "height": 844})
        await phone.goto(BASE + "/store/order")
        for _ in range(3):
            await phone.get_by_role("button", name="More Dairy").click()
        before = len((await view(ctx, "store"))["placed"])
        await phone.get_by_role("button", name="Send order").click()
        await phone.wait_for_timeout(1500)
        assert len((await view(ctx, "store"))["placed"]) == before + 1, "store order not placed"
        ok("store: placed an order")

        await phone.goto(BASE + "/store")
        await phone.get_by_role("button", name=re.compile("^Language")).click()
        await expect(phone.locator("h1").first).to_have_text(re.compile("[\\u0D80-\\u0DFF]"))
        await phone.get_by_role("button", name=re.compile("^Language")).click()
        await expect(phone.locator("h1").first).to_have_text(re.compile("[\\u0B80-\\u0BFF]"))
        await phone.get_by_role("button", name=re.compile("^Language")).click()
        await expect(phone.get_by_role("heading", name="My deliveries")).to_be_visible()
        ok("store: Sinhala, Tamil, back to English")

        # ---- Driver (phone): real offline, wrong code, right code, sync ------------------------------------------
        v = await view(ctx, "driver")
        d = v["driver"]
        run = sorted([o for o in v["orders"] if o.get("vehicle_id") == d["vehicle_id"] and o.get("trip_id") == d["trip_id"]], key=lambda o: o["stop_seq"])
        first = run[0]
        code = (await view(ctx, "store"))["codes"][first["order_ref"]]
        drv = await ctx.new_page()
        watch(drv, "driver")
        await drv.set_viewport_size({"width": 390, "height": 844})
        await drv.goto(BASE + f"/driver/stop/{first['order_ref']}")
        await drv.wait_for_timeout(1500)
        offline_now = True
        await ctx.set_offline(True)
        await drv.get_by_role("button", name="I've arrived").click()
        box = drv.locator("input[inputmode=numeric], input[placeholder*='•']").first
        wrong = "0000" if code != "0000" else "1111"
        await box.fill(wrong)
        await expect(drv.get_by_text("That code doesn't match this order.")).to_be_visible()
        assert await drv.get_by_role("button", name="Save delivery").is_disabled(), "save must stay locked on a wrong code"
        await box.fill(code)
        await expect(drv.get_by_text(re.compile("Code matches"))).to_be_visible()
        await drv.get_by_role("button", name="Save delivery").click()
        await drv.wait_for_timeout(1500)
        ok("driver offline: wrong code refused, right code accepted on the phone")
        await ctx.set_offline(False)
        await drv.wait_for_timeout(500)
        offline_now = False
        st = {}
        for _ in range(30):
            st = (await view(ctx, "dispatcher"))["states"].get(first["order_ref"], {})
            if st.get("stage") == "delivered":
                break
            await drv.wait_for_timeout(500)
        assert st.get("stage") == "delivered" and st.get("pod", {}).get("verified"), f"offline delivery did not sync: {st}"
        ok("signal back: the delivery synced by itself and the server verified the code")

        # ---- Driver: no code? name and signature instead (online this time) ----------------------------------------
        second = run[1] if run[1]["outlet_id"] != first["outlet_id"] else run[2]
        await drv.goto(BASE + f"/driver/stop/{second['order_ref']}")
        await drv.get_by_role("button", name="I've arrived").click()
        await drv.get_by_role("button", name=re.compile("No code")).click()
        await drv.get_by_placeholder("Name of the person receiving").fill("K. Perera")
        pad = drv.get_by_label("Signature pad: sign with your finger")
        await pad.scroll_into_view_if_needed()
        box = await pad.bounding_box()
        await drv.mouse.move(box["x"] + 30, box["y"] + 60)
        await drv.mouse.down()
        for i in range(12):
            await drv.mouse.move(box["x"] + 40 + i * 18, box["y"] + 50 + (i % 3) * 15)
        await drv.mouse.up()
        await drv.get_by_role("button", name="Save delivery").click()
        for _ in range(30):
            st2 = (await view(ctx, "dispatcher"))["states"].get(second["order_ref"], {})
            if st2.get("stage") == "delivered":
                break
            await drv.wait_for_timeout(500)
        assert st2.get("pod", {}).get("method") == "signature" and st2["pod"].get("name") == "K. Perera", f"signature proof not recorded: {st2}"
        ok("driver: no code, so a name and signature were taken instead, and the record says so")

        # ---- Store: report a problem on receipt -----------------------------------------------------------------
        await phone.goto(BASE + f"/store/receive/{first['order_ref']}")
        await phone.get_by_role("button").filter(has_text="Short").first.click()
        await phone.get_by_role("button", name=re.compile(r"^Report \d+ short and confirm the rest")).click()
        await phone.wait_for_timeout(1500)
        rec = (await view(ctx, "dispatcher"))["states"][first["order_ref"]].get("receipt")
        assert rec and not rec.get("ok"), f"receipt problem not recorded: {rec}"
        ok("store: reported a short delivery on receipt")

        # ---- Sign out ----------------------------------------------------------------------------------------------
        await page.goto(BASE + "/dispatch")
        await page.get_by_role("button", name=re.compile("^Dispatcher")).click()
        await page.get_by_role("button", name="Sign out").click()
        await page.wait_for_url(re.compile("/login"))
        ok("signed out")
        await browser.close()

    if errors:
        print(f"\n{len(errors)} problem(s):")
        for e in dict.fromkeys(errors):
            print(" -", e)
        sys.exit(1)
    print("PASS")


asyncio.run(main())
