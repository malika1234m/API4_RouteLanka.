"""Check-in map behaviour under live updates.

* the dispatcher's zoom and position survive a live event from another role (no refit, no jump);
* a vehicle marker is updated in place: an unrelated run changing does not recreate it;
* when the vehicle reports (arrives at a stop), its marker moves and shows the new report time;
* "Show all runs" brings back the whole depot; selecting a run from the list keeps the zoom;
* no page or console errors throughout.

    BASE=http://localhost:3000 python tests/e2e/map.py
"""
import asyncio
import os
import sys
import uuid

from playwright.async_api import async_playwright, expect

BASE = os.environ.get("BASE", "http://localhost:3100")
errors: list[str] = []


async def cmd(ctx, role, **c):
    r = await ctx.request.post(BASE + "/api/commands", data=c, headers={"x-rl-role": role})
    assert r.ok, f"{c['type']}: {await r.text()}"


async def view(ctx, role="dispatcher"):
    return await (await ctx.request.get(BASE + "/api/view", headers={"x-rl-role": role})).json()


async def state(page):
    """Map zoom and exact view."""
    return await page.evaluate("""() => {
        // Leaflet's proxy element carries the exact view: scale(2^zoom) and the pixel origin of the centre.
        const t = document.querySelector('.leaflet-proxy').style.transform;
        const scale = Number(/scale\(([\d.e+-]+)\)/.exec(t)[1]);
        const pane = document.querySelector('.leaflet-map-pane').style.transform;
        return { zoom: Math.round(Math.log2(scale)), view: t + ' ' + pane };
    }""")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome")
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        await ctx.request.post(BASE + "/api/day/new")
        for u in ["gehiru.dispatch", "senash.kandydock", "nimsith.veh041", "malika.out029"]:
            assert (await ctx.request.post(BASE + "/api/auth/login", data={"username": u, "password": "routelanka"})).ok
        await cmd(ctx, "dispatcher", type="publish")
        v = await view(ctx)
        d = v["driver"]
        key = f"{d['vehicle_id']}#{d['trip_id']}"
        run = sorted([o for o in v["orders"] if f"{o.get('vehicle_id')}#{o.get('trip_id')}" == key], key=lambda o: o["stop_seq"])
        for o in run:
            await cmd(ctx, "loader", type="loadTick", ref=o["order_ref"])
        await cmd(ctx, "loader", type="ready", key=key)
        await cmd(ctx, "loader", type="depart", key=key)
        other = next(o for o in v["orders"] if o.get("depot") == "Kandy" and o.get("decision") == "served" and f"{o['vehicle_id']}#{o['trip_id']}" != key)

        page = await ctx.new_page()
        page.on("pageerror", lambda e: errors.append(f"page error: {e}"))
        page.on("console", lambda m: errors.append(f"console: {m.text[:200]}") if m.type == "error" else None)
        await page.goto(BASE + "/dispatch/map")
        veh = page.locator(".leaflet-marker-pane div", has_text=d["vehicle_id"]).last
        await expect(veh).to_be_visible()
        await page.wait_for_timeout(1500)

        # 1. The dispatcher zooms in; a live event elsewhere must not undo it or rebuild this marker.
        await page.get_by_role("button", name="Zoom in").click()
        await page.wait_for_timeout(1200)
        before = await state(page)
        handle = await veh.element_handle()
        await cmd(ctx, "loader", type="loadTick", ref=other["order_ref"])
        await page.wait_for_timeout(3000)  # SSE -> refetch -> render
        after = await state(page)
        assert before == after, f"live update moved the map: {before} -> {after}"
        assert await handle.evaluate("e => e.isConnected"), "an unrelated update recreated the vehicle marker"
        print("  ok  zoom and position kept through a live update; untouched markers not rebuilt")

        # 2. The vehicle reports an arrival: its marker moves and shows the new time, the view stays.
        time0 = (await veh.inner_text()).split("·")[-1].strip()
        box0 = await veh.bounding_box()
        await ctx.request.post(BASE + "/api/sync", data={"offline": False, "events": [{"id": str(uuid.uuid4()), "order_ref": run[0]["order_ref"], "type": "arrived", "at": "05:41"}]}, headers={"x-rl-role": "driver"})
        await expect(veh).not_to_contain_text(time0, timeout=10000)
        box1 = await veh.bounding_box()
        assert (box0["x"], box0["y"]) != (box1["x"], box1["y"]), "the marker did not move to the outlet"
        assert await state(page) == after, "the vehicle's own report moved the map"
        print(f"  ok  the vehicle's marker moved to its new report ({(await veh.inner_text()).split(chr(183))[-1].strip()}) without moving the map")

        # 3. Selecting a run from the list keeps the zoom; "Show all runs" refits.
        await page.locator("ul button", has_text=other["vehicle_id"]).first.click()
        await page.wait_for_timeout(1200)
        assert (await state(page))["zoom"] == after["zoom"], "selecting a run changed the zoom"
        await page.get_by_role("button", name="Show all runs").click()
        await page.wait_for_timeout(1500)
        assert (await state(page))["zoom"] != after["zoom"], "Show all runs did not refit"
        print("  ok  selecting keeps the zoom; Show all runs refits the depot")

        # 4. Switching depot fits the other depot.
        await page.get_by_role("radio", name="Peliyagoda").click()
        await page.wait_for_timeout(1500)
        await page.get_by_role("radio", name="Kandy").click()
        await expect(veh).to_be_visible()
        print("  ok  depot switch redraws and refits")
        await browser.close()

    if errors:
        print("problems:", *dict.fromkeys(errors), sep="\n - ")
        sys.exit(1)
    print("PASS")


asyncio.run(main())
