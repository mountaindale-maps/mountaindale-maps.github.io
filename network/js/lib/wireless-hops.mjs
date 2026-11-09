/**
 * Wireless hop color rule.
 *
 * Walk the LAN parent of each wireless link (airmax-ptp or airmax-ptmp) back
 * to the main router, 0000-MD-UDM-Pro-2. WAN links are ignored.
 *
 * Initial: this is the first wireless link on that path. On the published
 * network those parents are the radios on the main-building roof, fed by
 * cable from 000-USW-Flex-Roof. They keep the existing wireless color.
 *
 * Secondary: the path already crossed another wireless link, so this hop
 * leaves a remote site and relays onward. Those strokes are red.
 *
 * Wired links are not classified.
 */
const WIRELESS = new Set(["airmax-ptp", "airmax-ptmp"]);
const CORE = "0000-MD-UDM-Pro-2";

function ends(link) {
  return {
    id: link?.id,
    parent: link?.parent || link?.from || null,
    child: link?.child || link?.to || null,
    medium: link?.medium,
  };
}

export function classifyWirelessHops(links, rootId = CORE) {
  const uplink = new Map();
  for (const raw of links || []) {
    const link = ends(raw);
    if (!link.child || link.medium === "wan") continue;
    if (!uplink.has(link.child)) uplink.set(link.child, link);
  }
  const hop = new Map();
  const initial = [];
  const secondary = [];
  for (const raw of links || []) {
    const link = ends(raw);
    if (!link.id || !WIRELESS.has(link.medium)) continue;
    let id = link.parent;
    let earlierWireless = false;
    const seen = new Set();
    while (id && id !== rootId && !seen.has(id)) {
      seen.add(id);
      const above = uplink.get(id);
      if (!above) break;
      if (WIRELESS.has(above.medium)) earlierWireless = true;
      id = above.parent;
    }
    const kind = id === rootId && !earlierWireless ? "initial" : "secondary";
    hop.set(link.id, kind);
    (kind === "initial" ? initial : secondary).push(link.id);
  }
  initial.sort();
  secondary.sort();
  return { hop, initial, secondary };
}
