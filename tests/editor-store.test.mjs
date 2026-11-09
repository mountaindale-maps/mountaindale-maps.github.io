import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { startEditorServer } from "../editor/server.mjs";
import { assertDataDirAllowed, loadPlan, savePlan } from "../editor/store.mjs";
import { importDocument, planFromPublic } from "../network/js/lib/plan.mjs";
import { readFileSync } from "node:fs";

const asbuilt = JSON.parse(readFileSync(new URL("../network/data/asbuilt_public.json", import.meta.url)));
const metadata = JSON.parse(readFileSync(new URL("../network/data/metadata.json", import.meta.url)));
const forbidden = [path.resolve("network"), path.resolve("dist")];

test("saves and backups stay outside the public tree and reload", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "md-plan-"));
  try {
    assert.throws(() => assertDataDirAllowed(path.resolve("network/data"), forbidden), /public files/);
    const plan = planFromPublic(asbuilt, metadata);
    plan.notes.push({ id: "n1", kind: "change-request", text: "Keep this private", created: "2026-11-08T00:00:00Z", device_ids: [] });
    await savePlan(dir, plan, forbidden);
    const reloaded = await loadPlan(dir);
    assert.equal(reloaded.notes[0].text, "Keep this private");
    plan.notes.push({ id: "n2", kind: "change-request", text: "Second", created: "2026-11-08T00:00:01Z", device_ids: [] });
    const second = await savePlan(dir, plan, forbidden);
    assert.ok(second.backup.startsWith(dir));
    assert.equal(second.backup.includes(`${path.sep}network${path.sep}`), false);
    const backup = JSON.parse(await readFile(second.backup, "utf8"));
    assert.equal(backup.notes.length, 1);
    const current = await readFile(path.join(dir, "current.json"), "utf8");
    assert.match(current, /Second/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("private import keeps management fields locally and the server stays on loopback", async () => {
  const imported = importDocument({
    schema_version: "1.0.0",
    devices: asbuilt.devices.map((device) => device.id === "0000-MD-UDM-Pro-2"
      ? { ...device, management_ip: "192.168.1.1", mac: "00:11:22:33:44:55", private_note: "rack key" }
      : device),
    links: asbuilt.links,
    wan: asbuilt.wan,
    location_groups: asbuilt.location_groups,
    landmarks: asbuilt.landmarks,
    notes: [{ id: "p", text: "Do not publish the shed conduit plan", kind: "change-request" }],
  }, metadata);
  assert.equal(imported.asbuilt.devices.find((device) => device.id === "0000-MD-UDM-Pro-2").local_private.management_ip, "192.168.1.1");
  assert.equal(imported.notes[0].text.includes("conduit"), true);
  const dir = await mkdtemp(path.join(tmpdir(), "md-http-"));
  const started = await startEditorServer({ port: 0, dataDir: dir, roots: { ... (await import("../editor/server.mjs")).editorRoots(), } });
  try {
    assert.equal(started.host, "127.0.0.1");
    const health = await fetch(`http://127.0.0.1:${started.port}/api/health`).then((response) => response.json());
    assert.equal(health.loopback, true);
    assert.equal(health.host, "127.0.0.1");
    assert.equal(health.publicWrite, false);
    assert.equal(health.dataDir.includes(`${path.sep}network${path.sep}`), false);
    const rejected = await fetch(`http://127.0.0.1:${started.port}/api/export`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://evil.example" },
      body: JSON.stringify({ plan: imported, selection: { confirmed: true, deviceIds: [] } }),
    });
    assert.equal(rejected.status, 403);
  } finally {
    await new Promise((resolve) => started.server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
