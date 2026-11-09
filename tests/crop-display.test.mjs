import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { IMAGE_HEIGHT, IMAGE_WIDTH, lonLatToImage } from "../network/js/lib/projection.mjs";
import { ellipsoidalDistanceM } from "../network/js/lib/distance.mjs";

const asbuilt = JSON.parse(readFileSync(new URL("../network/data/asbuilt_public.json", import.meta.url)));
const metadata = JSON.parse(readFileSync(new URL("../network/data/metadata.json", import.meta.url)));
const near = new Set(metadata.near_edge_device_ids);

test("every published device stays on its longitude and latitude inside the crop canvas", () => {
  assert.equal(asbuilt.devices.length, 70);
  assert.equal(metadata.imagery.width, 5980);
  assert.equal(metadata.imagery.height, 8062);
  assert.equal(metadata.tiles.native_zoom, 5);
  assert.deepEqual([...near].sort(), [
    "000-UAP-IW",
    "000-USW-Flex-Mini",
    "000-USW-Flex-Roof",
    "016-USW-Flex",
    "NB5AC-AP-93",
    "NBM5-AP-80",
    "NSL5AC-AP-89",
  ]);
  const outside = [];
  for (const device of asbuilt.devices) {
    const [u, v] = lonLatToImage(device.coords.lon, device.coords.lat);
    if (u < 0 || v < 0 || u > IMAGE_WIDTH || v > IMAGE_HEIGHT) outside.push(device.id);
  }
  assert.deepEqual(outside, []);
  const east = asbuilt.devices.find((device) => device.id === "096-USW-Flex-East");
  const radio = asbuilt.devices.find((device) => device.id === "NB5AC-STA-96");
  assert.equal(east.coords.lon, -104.9492324358572);
  assert.equal(radio.coords.lat, 38.58868203946042);
  const metres = ellipsoidalDistanceM(east.coords.lon, east.coords.lat, radio.coords.lon, radio.coords.lat);
  assert.ok(Math.abs(metres - 37.512) < 0.01);
});
