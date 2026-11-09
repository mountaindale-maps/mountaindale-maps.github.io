import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateCalibration } from "../network/js/lib/calibration.mjs";
import { formatFeet } from "../network/js/lib/distance.mjs";
import { measureLink, planFromPublic, setCablePath } from "../network/js/lib/plan.mjs";
import { verifiedRoute } from "../network/js/lib/plain-path.mjs";
import { ethernetRunFeet, linksWithCoords, routeLines } from "../network/js/lib/render-card.mjs";

const asbuilt = JSON.parse(readFileSync(new URL("../network/data/asbuilt_public.json", import.meta.url)));
const metadata = JSON.parse(readFileSync(new URL("../network/data/metadata.json", import.meta.url)));
const friendly = JSON.parse(readFileSync(new URL("../network/data/public_friendly_device_details.json", import.meta.url)));

function shownLines(plan, deviceId) {
  const claim = evaluateCalibration(plan.calibration || metadata);
  const links = linksWithCoords(plan.asbuilt.links, plan.asbuilt.devices, plan.asbuilt.wan, plan.cable_paths);
  const route = verifiedRoute(friendly.devices_by_id[deviceId], links);
  return { claim, links, route, lines: routeLines(route, links, claim) };
}

test("102-UAP-M shows each Ethernet run and no wireless length or path total", () => {
  const plan = planFromPublic(asbuilt, metadata);
  const { claim, lines } = shownLines(plan, "102-UAP-M");
  const text = lines.map((line) => line.text).join("\n");
  assert.equal(/total/i.test(text), false);
  assert.equal(text.includes("Ethernet cable length"), false);
  const hops = lines.filter((line) => line.hop);
  assert.ok(hops.some((line) => line.hop.connection === "wireless"));
  assert.ok(hops.some((line) => line.hop.connection === "cable"));
  for (const line of hops) {
    const link = plan.asbuilt.links.find((item) => item.id === line.hop.linkId);
    const feet = formatFeet(measureLink(plan, link, claim).totals.physical_cable_m);
    if (line.hop.connection === "wireless") {
      assert.equal(line.feet, null);
      assert.equal(line.via, "Wireless");
      assert.equal(line.text, `Wireless ${line.hop.to}`);
      assert.equal(line.text.includes("ft"), false);
    } else {
      const name = line.hop.interfaceName === "SFP+" ? `${line.hop.to}. SFP+ port.` : line.hop.to;
      assert.equal(ethernetRunFeet(line.hop, shownLines(plan, "102-UAP-M").links, claim), feet);
      assert.equal(line.text, `Ethernet cable, ${feet}. ${name}`);
    }
  }
});

test("a bend, slope, drop, and slack change that run to the editor length", () => {
  const base = planFromPublic(asbuilt, metadata);
  const id = "lnk:100-USW-Flex-Wilderness>102-UAP-M";
  const straight = measureLink(base, base.asbuilt.links.find((item) => item.id === id), null).totals.physical_cable_m;
  const bent = setCablePath(base, id, [{ lon: -104.9492, lat: 38.5876 }], [{
    vertical_drop_m: 1,
    slope_rise_m: 0.5,
    slack_m: 2,
    service_loop_m: 0.3,
  }]);
  const link = bent.asbuilt.links.find((item) => item.id === id);
  const physical = measureLink(bent, link, null).totals.physical_cable_m;
  assert.ok(physical > straight + 3);
  const { lines, links } = shownLines(bent, "102-UAP-M");
  const row = lines.find((line) => line.hop?.linkId === id);
  const feet = formatFeet(physical);
  assert.equal(ethernetRunFeet(row.hop, links, null), feet);
  assert.equal(row.text, `Ethernet cable, ${feet}. ${row.hop.to}`);
  assert.equal(lines.some((line) => /total/i.test(line.text)), false);
  assert.equal(JSON.stringify(base.cable_paths[id] || null), "null");
});
