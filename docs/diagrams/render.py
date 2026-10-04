"""Render every Mermaid diagram in docs/*.md to SVG and PNG in docs/diagrams/, for viewers that don't render Mermaid.

    pip install playwright && python -m playwright install chromium
    python docs/diagrams/render.py

Each diagram is named after its document and the heading above it, e.g. data-model--entity-relationship-overview.svg.
Mermaid is loaded from the jsDelivr CDN, so this needs a network connection.
"""
import asyncio
import re
from pathlib import Path

from playwright.async_api import async_playwright

DOCS = Path(__file__).resolve().parents[1]
OUT = Path(__file__).resolve().parent
PAGE = """<!doctype html><html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<style>body{margin:0;background:#fff;font-family:Arial,sans-serif}</style></head><body><div id="d"></div></body></html>"""


def diagrams():
    for md in sorted(DOCS.glob("*.md")):
        heading = md.stem
        lines = md.read_text().splitlines()
        i = 0
        while i < len(lines):
            if lines[i].startswith("#"):
                heading = lines[i].lstrip("#").strip()
            if lines[i].strip() == "```mermaid":
                j = i + 1
                while lines[j].strip() != "```":
                    j += 1
                slug = re.sub(r"[^a-z0-9]+", "-", heading.lower()).strip("-")
                yield f"{md.stem}--{slug}", "\n".join(lines[i + 1 : j])
                i = j
            i += 1


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(device_scale_factor=2)
        await page.set_content(PAGE)
        await page.wait_for_function("window.mermaid")
        await page.evaluate("mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' })")
        seen = set()
        for name, src in diagrams():
            n, k = name, 2
            while n in seen:
                n, k = f"{name}-{k}", k + 1
            seen.add(n)
            svg = await page.evaluate("async ([id, src]) => (await mermaid.render(id, src)).svg", [re.sub(r"\W", "_", n), src])
            (OUT / f"{n}.svg").write_text(svg)
            await page.evaluate("(svg) => { document.getElementById('d').innerHTML = svg; }", svg)
            await page.locator("#d svg").screenshot(path=str(OUT / f"{n}.png"), omit_background=False)
            print("rendered", n)
        await browser.close()


asyncio.run(main())
