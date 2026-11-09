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

/** One Google Earth icon per device type, then the shared link colors. */
export function legendEntries(devices, icons, iconUrl) {
  const counts = new Map();
  for (const device of devices || []) {
    if (!device || device.status === "planned" || device.record_class === "planned") continue;
    const icon = icons?.[device.id];
    if (!icon?.file) continue;
    const role = device.role || "device";
    if (!counts.has(role)) counts.set(role, new Map());
    const files = counts.get(role);
    files.set(icon.file, (files.get(icon.file) || 0) + 1);
  }
  const entries = [];
  for (const role of ROLE_ORDER) {
    const files = counts.get(role);
    if (!files) continue;
    const file = [...files.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    entries.push({ kind: "icon", src: iconUrl(file), label: ROLE_LABEL[role] });
  }
  entries.push(
    { kind: "line", mark: "solid", label: "Wired Ethernet" },
    { kind: "line", mark: "roof", label: "Wireless link from main building roof" },
    { kind: "line", mark: "relay", label: "Wireless relay link (second hop)" },
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
