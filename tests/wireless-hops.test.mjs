import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyWirelessHops } from "../network/js/lib/wireless-hops.mjs";

const asbuilt = JSON.parse(readFileSync(new URL("../network/data/asbuilt_public.json", import.meta.url)));
const byId = new Map(asbuilt.devices.map((device) => [device.id, device]));

const INITIAL = [
  "lnk:NB5AC-AP-93>NB5AC-STA-93",
  "lnk:NB5AC-AP-96>NB5AC-STA-96",
  "lnk:NBM5-AP-80>NBM5-STA-80",
  "lnk:NSL5AC-AP-49>NB5AC-STA-49",
  "lnk:NSL5AC-AP-89>NSL5AC-STA-089",
];

const SECONDARY = [
  "lnk:NB5AC-AP-91>NS5AC-STA-91",
  "lnk:NSL5AC-AP-57-75-98>NB5AC-STA-75",
  "lnk:NSL5AC-AP-57-75-98>NB5AC-STA-98",
  "lnk:NSL5AC-AP-57-75-98>NS5AC-STA-57",
];

test("published wireless links split into roof hops and downstream relays", () => {
  const { initial, secondary, hop } = classifyWirelessHops(asbuilt.links);
  assert.deepEqual(initial, INITIAL);
  assert.deepEqual(secondary, SECONDARY);
  assert.equal(hop.size, 9);
  for (const id of INITIAL) {
    const link = asbuilt.links.find((item) => item.id === id);
    const radio = byId.get(link.parent);
    assert.equal(radio.role, "radio");
    assert.equal(radio.location_group, "main-building");
    assert.equal(link.medium, "airmax-ptp");
  }
  for (const id of SECONDARY) {
    const link = asbuilt.links.find((item) => item.id === id);
    assert.notEqual(byId.get(link.parent).location_group, "main-building");
  }
  const wired = asbuilt.links.filter((link) => link.medium === "wired-ethernet");
  assert.ok(wired.length > 0);
  for (const link of wired) assert.equal(hop.has(link.id), false);
});

test("a new relay past the first wireless hop is secondary, and a new roof hop stays initial", () => {
  const extra = [
    ...asbuilt.links,
    { id: "lnk:new-roof", parent: "000-USW-Flex-Roof", child: "NEW-ROOF-AP", medium: "wired-ethernet" },
    { id: "lnk:NEW-ROOF-AP>NEW-STA", parent: "NEW-ROOF-AP", child: "NEW-STA", medium: "airmax-ptp" },
    { id: "lnk:NEW-STA>NEW-RELAY-AP", parent: "NEW-STA", child: "NEW-RELAY-AP", medium: "wired-ethernet" },
    { id: "lnk:NEW-RELAY-AP>NEW-FAR", parent: "NEW-RELAY-AP", child: "NEW-FAR", medium: "airmax-ptmp" },
  ];
  const { hop } = classifyWirelessHops(extra);
  assert.equal(hop.get("lnk:NEW-ROOF-AP>NEW-STA"), "initial");
  assert.equal(hop.get("lnk:NEW-RELAY-AP>NEW-FAR"), "secondary");
});
