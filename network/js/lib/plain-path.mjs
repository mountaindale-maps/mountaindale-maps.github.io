/**
 * Friendly cards join the descriptive sidecar to existing devices by exact id.
 * Paths and facts stay tied to recorded links and source status. A user
 * override changes only the words shown, not the evidence or the topology.
 */

const STATUS_NOTE = {
  "derived-from-role-and-topology": "From its role and connections. Not a coverage survey.",
  recorded: "Recorded in the source notes. Not a new field check.",
  "map-group-only": "Only the map group is known. That is not a connection or a surveyed spot.",
  tentative: "Tentative in the source notes.",
  unresolved: "Unresolved in the source notes.",
  "recorded-in-narrative": "From the written description, not the labelled height field, and not the aerial altitude.",
  unknown: "Not recorded.",
};

export function statusNote(status) {
  return STATUS_NOTE[status] || "Not recorded.";
}

export function verifiedRoute(detail, links) {
  const path = detail?.path_to_main_router;
  if (!path || path.status === "no-recorded-connection") {
    return {
      reachesRouter: false,
      reason: "none",
      text: path?.text || "No recorded path to the main router.",
      deviceIds: [],
      hops: [],
    };
  }
  if (path.status === "self") {
    return {
      reachesRouter: true,
      reason: "router",
      text: path.text || "This is the main router.",
      deviceIds: [...(path.device_ids || [])],
      hops: [],
    };
  }
  const byId = new Map((links || []).map((link) => [link.id, link]));
  const hops = [];
  for (const hop of path.hops || []) {
    const link = byId.get(hop.link_id);
    const forward = link && link.parent === hop.to_device && link.child === hop.from_device;
    const sameMedium = link && link.medium === hop.medium;
    const cableOk = hop.connection !== "cable" || hop.medium === "wired-ethernet";
    const wirelessOk = hop.connection !== "wireless" || hop.medium === "airmax-ptp" || hop.medium === "airmax-ptmp";
    if (!link || !forward || !sameMedium || !cableOk || !wirelessOk || link.medium === "wan") {
      return {
        reachesRouter: false,
        reason: "unconfirmed",
        text: "The recorded path could not be confirmed against the current links.",
        deviceIds: [],
        hops: [],
      };
    }
    hops.push({
      linkId: hop.link_id,
      from: hop.from_device,
      to: hop.to_device,
      medium: hop.medium,
      connection: hop.connection,
      label: hop.label,
      cableType: hop.cable_type ?? null,
      cableTypeStatus: hop.cable_type_status || (hop.connection === "cable" ? "unknown" : null),
      interfaceName: hop.interface ?? null,
    });
  }
  const ids = path.device_ids || [];
  const idOk = ids.length === hops.length + 1 && hops.every((hop, index) => hop.from === ids[index] && hop.to === ids[index + 1]);
  if (!idOk) {
    return {
      reachesRouter: false,
      reason: "unconfirmed",
      text: "The recorded path could not be confirmed against the current links.",
      deviceIds: [],
      hops: [],
    };
  }
  return {
    reachesRouter: true,
    reason: "connected",
    text: path.text || ids.join(" → "),
    deviceIds: [...ids],
    hops,
  };
}

function overrideText(profile, key) {
  const value = profile?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function publicCard(device, detail, profile = null) {
  const edited = profile?.provenance === "user-edited" ? profile : null;
  const purpose = line("What it does", detail?.purpose, overrideText(edited, "purpose"), false);
  const location = line("Location", detail?.location, overrideText(edited, "exact_location"), false);
  const mounting = line("Mounting", detail?.mounting, overrideText(edited, "mounting"), true);
  const height = heightLine(device, detail?.mounting_height);
  const power = powerLine(detail?.power, edited?.supply);
  const connection = overrideText(edited, "connection");
  return { purpose, location, mounting, height, power, connection };
}

function line(label, field, override, shortenUnknown) {
  if (override) {
    return { label, text: override, status: field?.status || null, edited: true, note: "Your wording. The source record is unchanged." };
  }
  if (!field || (shortenUnknown && field.status === "unknown")) {
    return { label, text: "Not recorded", status: field?.status || "unknown", edited: false, note: statusNote(field?.status || "unknown") };
  }
  return { label, text: field.text, status: field.status, edited: false, note: statusNote(field.status) };
}

function heightLine(device, field) {
  if (field?.status === "recorded" && device?.mount_height) {
    return {
      label: "Height",
      text: device.mount_height,
      status: "recorded",
      edited: false,
      note: "Labelled height from the source. Not the aerial altitude.",
    };
  }
  if (field?.status === "recorded-in-narrative") {
    return {
      label: "Height",
      text: field.text,
      status: field.status,
      edited: false,
      note: statusNote(field.status),
    };
  }
  return { label: "Height", text: "Not recorded", status: "unknown", edited: false, note: statusNote("unknown") };
}

function powerLine(field, supply) {
  const description = typeof supply?.description === "string" ? supply.description.trim() : "";
  const outlet = typeof supply?.outlet === "string" ? supply.outlet.trim() : "";
  const deviceId = typeof supply?.device_id === "string" ? supply.device_id.trim() : "";
  if (description || outlet || deviceId) {
    const parts = [description, deviceId ? `Supplying device ${deviceId}` : null, outlet ? `Outlet ${outlet}` : null].filter(Boolean);
    return {
      label: "Power",
      text: parts.join(". "),
      status: field?.status || null,
      edited: true,
      note: "Your wording. The source record is unchanged.",
    };
  }
  if (field?.status === "recorded") {
    return { label: "Power", text: field.text, status: "recorded", edited: false, note: statusNote("recorded") };
  }
  return { label: "Power", text: "Not recorded", status: "unknown", edited: false, note: statusNote("unknown") };
}

export function hopCaption(hop) {
  if (!hop) return "";
  if (hop.connection === "wireless") return hop.label || "Wireless link.";
  const port = hop.interfaceName ? `${hop.interfaceName} port. ` : "";
  return `${port}Cable type not recorded.`.trim();
}
