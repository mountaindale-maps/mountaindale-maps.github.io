import assert from "node:assert/strict";
import test from "node:test";
import { shownOnMap } from "../network/js/lib/map-links.mjs";

test("the SECOM WAN stroke is not drawn and other links stay", () => {
  assert.equal(shownOnMap({ id: "lnk:SECOM>0000-MD-UDM-Pro-2", parent: "SECOM", child: "0000-MD-UDM-Pro-2", medium: "wan" }), false);
  assert.equal(shownOnMap({ id: "lnk:Starlink Local Priority 500GB>0000-MD-UDM-Pro-2", parent: "Starlink Local Priority 500GB", child: "0000-MD-UDM-Pro-2", medium: "wan" }), true);
  assert.equal(shownOnMap({ id: "lnk:0000-MD-UDM-Pro-2>000-USW-24-PoE", parent: "0000-MD-UDM-Pro-2", child: "000-USW-24-PoE", medium: "wired-ethernet" }), true);
});
