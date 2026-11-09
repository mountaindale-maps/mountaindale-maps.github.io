import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { iconPixels } from "../network/js/lib/icon-layout.mjs";

const asbuilt = JSON.parse(readFileSync(new URL("../network/data/asbuilt_public.json", import.meta.url)));
const catalog = JSON.parse(readFileSync(new URL("../network/data/device_icons.json", import.meta.url)));
const icons = new Set(readdirSync(new URL("../network/icons/", import.meta.url)));

const UNASSIGNED = ["000-USW-Flex-Propane", "016-USW-Flex", "NSL5AC-STA-089", "049-USW-Flex"];

test("every published device is either exactly matched to an icon or listed as unassigned", () => {
  const ids = asbuilt.devices.map((device) => device.id);
  assert.deepEqual(catalog.unassigned, UNASSIGNED);
  assert.equal(Object.keys(catalog.icons).length, ids.length - UNASSIGNED.length);
  for (const id of ids) {
    if (UNASSIGNED.includes(id)) {
      assert.equal(catalog.icons[id], undefined);
      continue;
    }
    const icon = catalog.icons[id];
    assert.equal(typeof icon.file, "string");
    assert.ok(icons.has(icon.file));
    assert.equal(icon.scale, 1);
    const bytes = readFileSync(new URL(`../network/icons/${icon.file}`, import.meta.url));
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  }
  const raw = JSON.stringify(catalog);
  for (const word of ["Main Building", "Bath House", "SECOM POP", "base64", "description", "serial"]) {
    assert.equal(raw.includes(word), false, word);
  }
});

test("icon screen size stays inside 20 to 36 pixels when the Earth scale is 1", () => {
  assert.equal(iconPixels(1, 0.05), 20);
  assert.equal(iconPixels(1, 1), 36);
  assert.ok(iconPixels(1, 0.2) > 20 && iconPixels(1, 0.2) < 36);
});
