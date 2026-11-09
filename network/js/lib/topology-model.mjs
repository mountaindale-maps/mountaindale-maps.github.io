/** Pure topology helpers. Groups are not links. Device ids are the stable keys. */

export function defaultExpandedKeys(root) {
  const keys = new Set();
  const walk = (node) => {
    if (!node) return;
    if (node.default_expanded) keys.add(node.key);
    for (const child of node.children || []) walk(child);
  };
  walk(root);
  return keys;
}

export function applyFocus(expanded, hierarchy, deviceId) {
  const next = new Set(expanded);
  if (!deviceId) return next;
  for (const key of hierarchy.ancestors?.[deviceId] || []) next.add(key);
  next.add(deviceId);
  return next;
}

export function highlightForDevice(hierarchy, device) {
  if (!device || device.status === "inactive" || device.id === "088-UAP-M") {
    return { linkIds: [], nodeIds: device ? [device.id] : [], ancestors: [] };
  }
  const path = hierarchy.path_links?.[device.id] || [];
  if (!path.length && device.id !== "0000-MD-UDM-Pro-2") {
    return { linkIds: [], nodeIds: [device.id], ancestors: hierarchy.ancestors?.[device.id] || [] };
  }
  const linkIds = [...path];
  if (hierarchy.primary_wan_link_id) linkIds.push(hierarchy.primary_wan_link_id);
  return {
    linkIds,
    nodeIds: [device.id, ...(hierarchy.device_path?.[device.id] || [])],
    ancestors: hierarchy.ancestors?.[device.id] || [],
  };
}

export function highlightForGroup(group) {
  return {
    deviceIds: [...(group?.device_ids || [])],
    linkIds: [],
  };
}

/**
 * Rebuild a device tree from links. Branch nodes are not invented.
 * Throws if a device has two LAN parents. WAN links are not LAN parents.
 */
export function rebuildHierarchy(devices, links, wan = []) {
  const lan = links.filter((link) => link.medium !== "wan");
  const parents = new Map();
  for (const link of lan) {
    if (parents.has(link.child) && parents.get(link.child).parent !== link.parent) {
      const error = new Error(`DUAL UPLINK ${link.child}`);
      error.code = "DUAL_UPLINK";
      throw error;
    }
    parents.set(link.child, link);
  }
  const byId = new Map(devices.map((device) => [device.id, device]));
  const childLinks = new Map();
  for (const link of lan) {
    if (!childLinks.has(link.parent)) childLinks.set(link.parent, []);
    childLinks.get(link.parent).push(link);
  }
  const devicePath = {};
  const pathLinks = {};
  const ancestors = {};
  const visiting = new Set();
  const walk = (id, path, linksSoFar, ancestorKeys) => {
    if (visiting.has(id)) {
      const error = new Error(`CYCLE ${id}`);
      error.code = "CYCLE";
      throw error;
    }
    visiting.add(id);
    devicePath[id] = path;
    pathLinks[id] = linksSoFar;
    ancestors[id] = ancestorKeys;
    const node = {
      key: id,
      kind: "device",
      device_id: id,
      label: id,
      role: byId.get(id)?.role || null,
      status: byId.get(id)?.status || "active",
      uplink_link_id: parents.get(id)?.id || null,
      uplink_medium: parents.get(id)?.medium || null,
      wireless_hop: parents.get(id)?.medium?.startsWith("airmax") || false,
      default_expanded: id === "0000-MD-UDM-Pro-2" || id === "000-USW-24-PoE",
      collapsible: (childLinks.get(id) || []).length > 0,
      children: [],
    };
    for (const link of childLinks.get(id) || []) {
      if (!byId.has(link.child)) continue;
      node.children.push(walk(link.child, [...path, link.child], [...linksSoFar, link.id], [...ancestorKeys, id]));
    }
    visiting.delete(id);
    return node;
  };
  const roots = devices.filter((device) => !parents.has(device.id));
  const udm = roots.find((device) => device.id === "0000-MD-UDM-Pro-2");
  const unconnected = roots
    .filter((device) => device.id !== "0000-MD-UDM-Pro-2")
    .map((device) => ({
      key: device.id,
      kind: "device",
      device_id: device.id,
      label: device.id,
      role: device.role,
      status: device.status,
      note: device.status === "inactive" ? "Inactive AP, no uplink" : "No LAN parent",
    }));
  const wanSources = (wan || []).map((entry) => ({
    id: entry.id,
    wan_role: entry.wan_role,
    label: entry.label,
    link_id: `lnk:${entry.id}>0000-MD-UDM-Pro-2`,
  }));
  const root = {
    key: "wan:internet",
    kind: "wan",
    label: "Internet / WAN",
    default_expanded: true,
    collapsible: false,
    wan_sources: wanSources,
    children: udm ? [walk(udm.id, [udm.id], [], ["wan:internet"])] : [],
  };
  return {
    schema: "mountaindale.topology_hierarchy",
    schema_version: "1.0.0",
    root,
    unconnected,
    ancestors,
    device_path: devicePath,
    path_links: pathLinks,
    primary_wan_link_id: "lnk:SECOM>0000-MD-UDM-Pro-2",
    rebuilt: true,
  };
}
