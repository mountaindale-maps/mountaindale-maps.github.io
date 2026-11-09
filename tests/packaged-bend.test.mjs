import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium, firefox } from "@playwright/test";

const zipPath = path.resolve("packages/mountaindale-local-editor.zip");

async function strokePoint(page) {
  return page.evaluate(() => {
    const map = document.querySelector("#map");
    const rect = map.getBoundingClientRect();
    const lines = [...document.querySelectorAll("polyline.cable-hit")];
    for (const line of lines) {
      const pairs = line.getAttribute("points").trim().split(/\s+/);
      const points = pairs.map((pair) => {
        const [x, y] = pair.split(",").map(Number);
        return { x, y };
      });
      for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        if (Math.hypot(end.x - start.x, end.y - start.y) < 36) continue;
        for (const t of [0.32, 0.68, 0.5]) {
          const x = start.x + (end.x - start.x) * t;
          const y = start.y + (end.y - start.y) * t;
          if (x < 12 || y < 12 || x > rect.width - 12 || y > rect.height - 12) continue;
          const hit = document.elementFromPoint(rect.left + x, rect.top + y);
          if (hit?.classList?.contains("cable-hit")) {
            return { x: rect.left + x, y: rect.top + y, id: line.dataset.linkId };
          }
        }
      }
    }
    return null;
  });
}

async function withPackagedEditor(port, run) {
  const root = await mkdtemp(path.join(tmpdir(), "md-packaged-"));
  const dataDir = path.join(root, "plans");
  await new Promise((resolve, reject) => {
    const child = spawn("unzip", ["-q", zipPath, "-d", root], { stdio: "inherit" });
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`unzip exited ${code}`)));
  });
  const server = spawn("node", ["editor/server.mjs"], {
    cwd: path.join(root, "mountaindale-local-editor"),
    env: { ...process.env, PORT: String(port), MOUNTAINDALE_DATA_DIR: dataDir },
    stdio: "ignore",
  });
  try {
    const deadline = Date.now() + 10000;
    let up = false;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`);
        if (response.ok) {
          up = true;
          break;
        }
      } catch { /* server still starting */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!up) throw new Error("Packaged editor did not start");
    await run(`http://127.0.0.1:${port}/`);
  } finally {
    server.kill("SIGTERM");
    await rm(root, { recursive: true, force: true });
  }
}

for (const [name, browserType, port] of [["chromium", chromium, 8791], ["firefox", firefox, 8792]]) {
  test(`packaged editor cable stroke selects and bends in ${name}`, async () => {
    await withPackagedEditor(port, async (url) => {
      const browser = await browserType.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await page.locator("#bend-hint").waitFor();
        await page.locator("polyline.link").first().waitFor();
        const before = await page.locator("#map").getAttribute("data-view-u");
        const target = await strokePoint(page);
        assert.ok(target, "no Ethernet stroke pixel was hittable at default zoom");
        await page.mouse.click(target.x, target.y);
        await page.locator(`polyline.link.is-hot[data-link-id="${target.id}"]`).waitFor();
        const handles = await page.locator(".midpoint").count();
        assert.ok(handles > 0, "selecting a cable did not show handles");
        const dragFrom = await strokePoint(page);
        assert.ok(dragFrom, "the selected cable stroke was not hittable");
        await page.mouse.move(dragFrom.x, dragFrom.y);
        await page.mouse.down();
        await page.mouse.move(dragFrom.x + 48, dragFrom.y + 32, { steps: 6 });
        await page.mouse.up();
        const vertices = await page.locator(".vertex").count();
        assert.ok(vertices > 0, "dragging the stroke did not add a bend");
        const after = await page.locator("#map").getAttribute("data-view-u");
        assert.ok(Math.abs(Number(after) - Number(before)) < 0.01);
        await page.locator("#bend-hint").waitFor();
      } finally {
        await browser.close();
      }
    });
  });
}
