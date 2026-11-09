import assert from "node:assert/strict";
import test from "node:test";
import { iconPixels, placeIcon } from "../network/js/lib/icon-layout.mjs";
import { LINK_KEY, legendEntries } from "../network/js/lib/legend.mjs";

test("icon size stays between 20 and 36 pixels and grows when zoomed in", () => {
  const far = iconPixels(1, 0.05);
  const near = iconPixels(1, 1);
  assert.equal(far, 20);
  assert.equal(near, 36);
  assert.ok(near > far);
  assert.ok(iconPixels(3, 1) <= 36);
  assert.ok(iconPixels(0.2, 0.05) >= 20);
});

test("the hotSpot sits on the map point and the hit target is at least 32 pixels", () => {
  const placed = placeIcon(100, 80, 1, 1, { x: 0.5, y: 0, xunits: "fraction", yunits: "fraction" });
  assert.ok(placed.hit >= 32);
  assert.ok(placed.size >= 20 && placed.size <= 36);
  const hotX = placed.left + placed.imageLeft + placed.size * 0.5;
  const hotY = placed.top + placed.imageTop + placed.size;
  assert.ok(Math.abs(hotX - 100) < 0.01);
  assert.ok(Math.abs(hotY - 80) < 0.01);
});

test("the legend names both wireless colors from one list", () => {
  const labels = legendEntries([
    { id: "r", role: "router", status: "active" },
    { id: "s1", role: "switch", status: "active" },
    { id: "s2", role: "switch", status: "active" },
  ], {
    r: { file: "router.png" },
    s1: { file: "switch-rare.png" },
    s2: { file: "switch.png" },
  }, (file) => file).map((entry) => entry.label);
  assert.equal(labels.filter((label) => label === "Switch").length, 1);
  assert.equal(labels[0], "Router");
  assert.equal(labels[1], "Switch");
  assert.ok(labels.includes("Wireless link from main building roof"));
  assert.ok(labels.includes("Wireless relay link (second hop)"));
  assert.equal(labels.some((label) => label.includes("square")), false);
  assert.deepEqual(LINK_KEY.map((entry) => entry.label), [
    "Ethernet",
    "Wireless link from main building roof",
    "Wireless relay link (second hop)",
  ]);
});
