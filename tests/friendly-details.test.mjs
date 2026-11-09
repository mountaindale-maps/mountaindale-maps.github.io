import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHistory, redo, undo } from "../network/js/lib/history.mjs";
import { addNote, planFromPublic, setPublicProfile } from "../network/js/lib/plan.mjs";
import { publicCard, verifiedRoute } from "../network/js/lib/plain-path.mjs";
import { buildPublicSnapshot } from "../network/js/lib/sanitize.mjs";

const asbuilt = JSON.parse(readFileSync(new URL("../network/data/asbuilt_public.json", import.meta.url)));
const metadata = JSON.parse(readFileSync(new URL("../network/data/metadata.json", import.meta.url)));
const friendly = JSON.parse(readFileSync(new URL("../network/data/public_friendly_device_details.json", import.meta.url)));
const links = new Map(asbuilt.links.map((link) => [link.id, link]));

test("friendly details join every public device and leave coordinates alone", () => {
  assert.equal(friendly.schema, "mountaindale-public-friendly-device-details");
  assert.equal(friendly.source_policy.live_earth_verified, false);
  const ids = asbuilt.devices.map((device) => device.id).sort();
  assert.deepEqual(Object.keys(friendly.devices_by_id).sort(), ids);
  assert.equal(JSON.stringify(friendly).includes("integration-source-gaps"), false);
  assert.equal(JSON.stringify(friendly).includes("validation-summary"), false);
  const before = JSON.stringify(asbuilt.devices.map((device) => [device.id, device.coords, device.mount_height]));
  for (const device of asbuilt.devices) {
    const detail = friendly.devices_by_id[device.id];
    assert.equal(detail.id, device.id);
    assert.equal(detail.status, device.status);
  }
  assert.equal(JSON.stringify(asbuilt.devices.map((device) => [device.id, device.coords, device.mount_height])), before);
  assert.equal(asbuilt.devices.find((device) => device.id === "049-USW-Flex").coords.alt_m, null);
});

test("paths use the recorded links, and wired cable type stays unknown", () => {
  const seen = new Map();
  for (const device of asbuilt.devices) {
    const detail = friendly.devices_by_id[device.id];
    const route = verifiedRoute(detail, asbuilt.links);
    if (device.id === "088-UAP-M") {
      assert.equal(route.reachesRouter, false);
      assert.equal(route.hops.length, 0);
      continue;
    }
    assert.equal(route.reachesRouter, true, device.id);
    assert.deepEqual(route.deviceIds, detail.path_to_main_router.device_ids);
    for (const hop of route.hops) {
      const link = links.get(hop.linkId);
      assert.equal(link.parent, hop.to);
      assert.equal(link.child, hop.from);
      assert.equal(link.medium, hop.medium);
      assert.equal(hop.medium === "wan", false);
      seen.set(hop.linkId, hop.medium);
      if (hop.connection === "cable") {
        assert.equal(hop.cableType, null);
        assert.equal(hop.cableTypeStatus, "unknown");
        assert.equal(/fiber|DAC|direct-attach/i.test(hop.label), false);
      }
    }
  }
  const counts = { "wired-ethernet": 0, "airmax-ptp": 0, "airmax-ptmp": 0 };
  for (const medium of seen.values()) counts[medium] += 1;
  assert.deepEqual(counts, { "wired-ethernet": 59, "airmax-ptp": 6, "airmax-ptmp": 3 });
  const core = verifiedRoute(friendly.devices_by_id["000-USW-24-PoE"], asbuilt.links);
  assert.equal(core.hops[0].interfaceName, "SFP+");
  assert.match(core.hops[0].label, /SFP\+/);
  const inwall = friendly.devices_by_id["089-UAP-IW-ROCHSTAR"];
  const inwallRoute = verifiedRoute(inwall, asbuilt.links);
  assert.deepEqual(inwallRoute.deviceIds, [
    "089-UAP-IW-ROCHSTAR",
    "089-USW-Flex-David",
    "NSL5AC-STA-089",
    "NSL5AC-AP-89",
    "000-USW-Flex-Roof",
    "000-USW-24-PoE",
    "0000-MD-UDM-Pro-2",
  ]);
  assert.deepEqual(inwallRoute.hops.map((hop) => hop.connection), ["cable", "cable", "wireless", "cable", "cable", "cable"]);
  const card = publicCard(asbuilt.devices.find((device) => device.id === "089-UAP-IW-ROCHSTAR"), inwall, null);
  assert.equal(card.power.text, "Not recorded");
  assert.equal(card.mounting.text, "Not recorded");
  assert.match(card.location.text, /Map group: Site 89/);
  assert.equal(/cabin|wall fastening|electrical feed/i.test(card.location.text + card.mounting.text + card.power.text), false);
  assert.match(card.height.note, /not the labelled height/);
  const inactive = publicCard(asbuilt.devices.find((device) => device.id === "088-UAP-M"), friendly.devices_by_id["088-UAP-M"], null);
  assert.match(inactive.mounting.text, /6×6 post/);
  assert.equal(inactive.power.text, "Not recorded");
  const nanos = verifiedRoute(friendly.devices_by_id["098-UAP-M"], asbuilt.links);
  assert.deepEqual(nanos.deviceIds.slice(0, 3), ["098-UAP-M", "NanoSwitch", "099-USW-Flex"]);
});

test("a public wording edit is separate from source evidence and does not leak notes", () => {
  let plan = planFromPublic(asbuilt, metadata);
  const id = "089-UAP-IW-ROCHSTAR";
  plan = setPublicProfile(plan, id, {
    purpose: "Wi-Fi for the recorded site group.",
    exact_location: "",
    mounting: "",
    supply: { description: "Recorded feed from the site switch.", device_id: "089-USW-Flex-David", outlet: "" },
  });
  plan = addNote(plan, { text: "Private shed key stays here", id: "private-note" });
  const device = plan.asbuilt.devices.find((item) => item.id === id);
  assert.equal(device.public_profile.provenance, "user-edited");
  assert.equal(device.coords.lon, asbuilt.devices.find((item) => item.id === id).coords.lon);
  assert.equal(JSON.stringify(plan.asbuilt.links), JSON.stringify(planFromPublic(asbuilt, metadata).asbuilt.links));
  assert.equal(friendly.devices_by_id[id].power.status, "unknown");
  let history = createHistory(planFromPublic(asbuilt, metadata));
  history = { past: [history.present], present: plan, future: [] };
  history = undo(history);
  assert.equal(history.present.asbuilt.devices.find((item) => item.id === id).public_profile, undefined);
  history = redo(history);
  assert.equal(history.present.asbuilt.devices.find((item) => item.id === id).public_profile.purpose, "Wi-Fi for the recorded site group.");
  const exported = buildPublicSnapshot(asbuilt, plan, {
    confirmed: true,
    deviceIds: [id],
    includeGroups: false,
    includeConnectivity: false,
  });
  const published = exported.snapshot.devices.find((item) => item.id === id);
  assert.equal(published.public_profile.purpose, "Wi-Fi for the recorded site group.");
  assert.equal(published.public_profile.supply.device_id, "089-USW-Flex-David");
  assert.equal(published.public_profile.evidence, undefined);
  const shown = publicCard(published, friendly.devices_by_id[id], published.public_profile);
  assert.equal(shown.purpose.text, published.public_profile.purpose);
  assert.match(shown.purpose.note, /source record is unchanged/);
  assert.equal(JSON.stringify(exported.snapshot).includes("Private shed key"), false);
  assert.equal(JSON.stringify(exported.snapshot).includes("management_ip"), false);
  const cleared = setPublicProfile(plan, id, {
    purpose: "",
    supply: { description: "", device_id: "", outlet: "" },
  });
  assert.equal(cleared.asbuilt.devices.find((item) => item.id === id).public_profile, undefined);
  assert.throws(() => setPublicProfile(plan, id, { supply: { device_id: "PLAN-SHED-AP" } }), /as-built record/);
  const secret = setPublicProfile(plan, id, { purpose: "gate password" });
  assert.throws(() => buildPublicSnapshot(asbuilt, secret, {
    confirmed: true,
    deviceIds: [id],
    includeGroups: false,
    includeConnectivity: false,
  }), /sanitizer/i);
});
