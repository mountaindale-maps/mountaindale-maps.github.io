import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium, firefox } from "@playwright/test";

const zipPath = path.resolve("packages/mountaindale-local-editor.zip");
const linkId = "lnk:099-USW-Flex>099-UAP-U7O";

async function withPackagedEditor(port, run) {
  const root = await mkdtemp(path.join(tmpdir(), "md-packaged-link-"));
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

async function selectDeviceFromTree(page, id) {
  const ancestors = [
    "000-USW-Flex-Roof",
    "NB5AC-AP-96",
    "NB5AC-STA-96",
    "096-USW-Flex-East",
    "NSL5AC-AP-57-75-98",
    "NB5AC-STA-98",
    "098-USW-Flex-Getaway",
    "099-USW-Flex",
  ];
  for (const key of ancestors) {
    await page.locator(`#topo-body [data-key="${key}"] [aria-expanded="false"]`).click();
  }
  await page.locator(`#topo-body [data-key="${id}"] .topo-label`).click();
}

async function pickDevice(page, inputId, typed, canonical) {
  const input = page.locator(`#${inputId}`);
  await input.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(typed, { delay: 12 });
  await page.keyboard.press("Enter");
  assert.equal(await input.inputValue(), canonical);
}

for (const [name, browserType, port] of [["chromium", chromium, 8793], ["firefox", firefox, 8794]]) {
  test(`packaged editor adds a link from the pickers in ${name}`, async () => {
    await withPackagedEditor(port, async (url) => {
      const browser = await browserType.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await page.locator("#modes [data-mode='connect']").click();
        await page.locator("#add-link").click();
        await page.locator("#link-message").waitFor();
        assert.match(await page.locator("#link-message").innerText(), /Pick a parent device/);
        assert.equal(await page.locator(`polyline[data-link-id="${linkId}"]`).count(), 2);

        await page.locator("#modes [data-mode='path']").click();
        await selectDeviceFromTree(page, "099-UAP-U7O");
        await page.getByRole("button", { name: linkId }).click();
        await page.locator("#modes [data-mode='connect']").click();
        await page.locator("#remove-link").click();
        await page.locator("#remove-link").click();
        assert.match(await page.locator("#link-message").innerText(), new RegExp(`Removed ${linkId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
        assert.equal(await page.locator(`polyline[data-link-id="${linkId}"]`).count(), 0);

        assert.equal(await page.locator("#link-medium").inputValue(), "wired-ethernet");
        await pickDevice(page, "link-parent", "099-usw-flex", "099-USW-Flex");
        await pickDevice(page, "link-child", "099-uap-u7o", "099-UAP-U7O");
        await page.locator("#add-link").click();
        assert.match(await page.locator("#link-message").innerText(), /Added Ethernet cable 099-USW-Flex → 099-UAP-U7O/);
        await page.locator(`polyline.link.is-hot.medium-wired-ethernet[data-link-id="${linkId}"]`).waitFor();

        await page.locator("#save").click();
        await page.locator("#save-state").filter({ hasText: "Saved locally" }).waitFor();
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.locator(`polyline.medium-wired-ethernet[data-link-id="${linkId}"]`).waitFor();
      } finally {
        await browser.close();
      }
    });
  });
}
