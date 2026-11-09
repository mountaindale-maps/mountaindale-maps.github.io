function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function renderNode(node, state, handlers, depth) {
  const expanded = state.expanded.has(node.key);
  const row = h("div", "topo-row");
  row.style.paddingLeft = `${8 + depth * 14}px`;
  row.dataset.key = node.key;
  row.dataset.kind = node.kind;
  if (state.hotDeviceId === node.key || state.hotNodeIds?.has(node.key)) row.dataset.hot = "1";
  if (state.ancestorKeys?.has(node.key)) row.classList.add("is-ancestor");
  if (node.kind === "device" && state.devices.get(node.device_id)?.status === "inactive") row.classList.add("is-inactive");
  if (node.collapsible !== false && (node.children?.length || node.kind === "branch")) {
    const chevron = h("button", "chevron", expanded ? "▾" : "▸");
    chevron.type = "button";
    chevron.setAttribute("aria-expanded", expanded ? "true" : "false");
    chevron.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${node.label || node.key}`);
    chevron.addEventListener("click", (event) => {
      event.stopPropagation();
      handlers.onToggle(node.key);
    });
    row.appendChild(chevron);
  } else {
    row.appendChild(h("span", "chevron spacer", ""));
  }
  const medium = node.uplink_medium || node.backhaul || "";
  if (depth > 0 && (medium || node.wireless_hop)) {
    const wireless = node.wireless_hop || /airmax|wireless|radio/i.test(medium);
    const mark = h("span", wireless ? "uplink is-radio" : "uplink is-wire", "");
    mark.title = wireless ? "Wireless link" : "Ethernet cable";
    row.appendChild(mark);
  }
  const label = h("button", "topo-label", node.label || node.key);
  label.type = "button";
  if (node.device_count != null) {
    label.appendChild(h("span", "count", ` ${node.device_count ?? node.device_ids?.length ?? node.children?.length ?? 0}`));
  } else if (node.kind === "branch") {
    label.appendChild(h("span", "count", ` ${node.device_ids?.length || 0}`));
  }
  label.addEventListener("click", () => {
    if (node.kind === "device") handlers.onSelectDevice(node.device_id || node.key);
    else if (node.kind === "branch") handlers.onSelectBranch(node);
    else handlers.onToggle(node.key);
  });
  row.appendChild(label);
  if (node.wireless_hop) row.appendChild(h("span", "hop", "wireless"));
  const wrap = h("div", "topo-node");
  wrap.appendChild(row);
  if (expanded && node.wan_sources) {
    for (const source of node.wan_sources) {
      const wan = h("button", "wan-source", source.label);
      wan.type = "button";
      wan.dataset.linkId = source.link_id;
      wan.dataset.wanRole = source.wan_role;
      wan.style.paddingLeft = `${28 + depth * 14}px`;
      if (state.hotLinkIds?.has(source.link_id)) wan.dataset.hot = "1";
      wrap.appendChild(wan);
    }
  }
  if (expanded) {
    for (const child of node.children || []) wrap.appendChild(renderNode(child, state, handlers, depth + 1));
  }
  return wrap;
}

export function mountTopology(container, { hierarchy, devices, handlers }) {
  const devicesMap = new Map(devices.map((device) => [device.id, device]));
  let lastHot = null;
  const paint = (state) => {
    container.replaceChildren();
    const tree = h("div", "topo-tree");
    tree.appendChild(renderNode(hierarchy.root, { ...state, devices: devicesMap }, handlers, 0));
    if (hierarchy.unconnected?.length) {
      const title = h("p", "topo-unconnected", "No connection recorded");
      tree.appendChild(title);
      for (const item of hierarchy.unconnected) {
        const button = h("button", "topo-label is-inactive", item.label || item.device_id);
        button.type = "button";
        button.dataset.key = item.device_id;
        if (state.hotDeviceId === item.device_id) button.dataset.hot = "1";
        button.addEventListener("click", () => handlers.onSelectDevice(item.device_id));
        tree.appendChild(button);
      }
    }
    container.appendChild(tree);
    if (state.hotDeviceId && state.hotDeviceId !== lastHot) {
      const node = container.querySelector(`[data-key="${CSS.escape(state.hotDeviceId)}"]`);
      node?.scrollIntoView({ block: "nearest" });
    }
    lastHot = state.hotDeviceId || null;
  };
  return { update: paint };
}
