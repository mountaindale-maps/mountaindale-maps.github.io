export const LINK_KEY = Object.freeze([
  { kind: "line", mark: "solid", label: "Ethernet" },
  { kind: "line", mark: "roof", label: "Wireless link from main building roof" },
  { kind: "line", mark: "relay", label: "Wireless relay link (second hop)" },
]);

const ROLE_ORDER = ["router", "switch", "ap", "radio"];
const ROLE_LABEL = {
  router: "Router",
  switch: "Switch",
  ap: "Access point",
  radio: "airMAX radio",
};

function roleIndex(role) {
  const index = ROLE_ORDER.indexOf(role);
  return index === -1 ? ROLE_ORDER.length : index;
}

/** Device icons, then the shared link colors. Roles with no icon keep a shape. */
export function legendEntries(devices, icons, iconUrl) {
  const byFile = new Map();
  const missing = new Set();
  for (const device of devices || []) {
    if (!device || device.status === "planned" || device.record_class === "planned") continue;
    const icon = icons?.[device.id];
    if (!icon?.file) {
      missing.add(device.role || "device");
      continue;
    }
    if (!byFile.has(icon.file)) byFile.set(icon.file, { file: icon.file, roles: new Set() });
    byFile.get(icon.file).roles.add(device.role || "device");
  }
  const entries = [...byFile.values()]
    .sort((a, b) => Math.min(...[...a.roles].map(roleIndex)) - Math.min(...[...b.roles].map(roleIndex)) || a.file.localeCompare(b.file))
    .map((item) => ({
      kind: "icon",
      src: iconUrl(item.file),
      label: [...item.roles].sort((a, b) => roleIndex(a) - roleIndex(b)).map((role) => ROLE_LABEL[role] || role).join(", "),
    }));
  for (const role of ROLE_ORDER) {
    if (missing.has(role)) entries.push({ kind: "swatch", mark: `role-${role}`, label: ROLE_LABEL[role] });
  }
  entries.push(
    { kind: "swatch", mark: "status-inactive", label: "Inactive, no uplink" },
    { kind: "line", mark: "solid", label: "Wired Ethernet" },
    { kind: "line", mark: "roof", label: "Wireless link from main building roof" },
    { kind: "line", mark: "relay", label: "Wireless relay link (second hop)" },
    { kind: "swatch", mark: "flag", label: "Uncertain placement or tentative tag" },
  );
  return entries;
}

export function renderLegend(list, entries) {
  if (!list) return;
  list.replaceChildren();
  for (const entry of entries) {
    const item = document.createElement("li");
    if (entry.kind === "icon") {
      const image = document.createElement("img");
      image.className = "legend-icon";
      image.alt = "";
      image.src = entry.src;
      item.append(image);
    } else {
      const mark = document.createElement("i");
      mark.className = entry.kind === "line" ? `line ${entry.mark}` : `swatch ${entry.mark}`;
      item.append(mark);
    }
    item.append(document.createTextNode(entry.label));
    list.append(item);
  }
}
