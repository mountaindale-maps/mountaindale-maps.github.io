import { formatFeet } from "./lib/distance.mjs";

export function segmentRows(metrics) {
  return metrics.segments.map((segment, index) => ({
    index,
    horizontal: formatFeet(segment.horizontal_ellipsoidal_m),
    grid: formatFeet(segment.horizontal_grid_utm_m),
    terrain: formatFeet(segment.terrain_slope_m),
    physical: formatFeet(segment.physical_cable_m),
    rise: formatFeet(segment.vertical_rise_m),
    slack: formatFeet(segment.slack_m),
    loop: formatFeet(segment.service_loop_m),
    label: metrics.label,
  }));
}

export function fillDistanceList(container, metrics, heading) {
  container.replaceChildren();
  const title = document.createElement("h3");
  title.textContent = heading || "Route estimate";
  container.appendChild(title);
  const badge = document.createElement("p");
  badge.className = "unverified";
  badge.textContent = metrics.label;
  container.appendChild(badge);
  metrics.segments.forEach((segment, index) => {
    const row = document.createElement("div");
    row.className = "segment-row";
    row.dataset.segment = String(index);
    const name = document.createElement("strong");
    name.textContent = `Segment ${index + 1}`;
    const body = document.createElement("p");
    body.textContent = [
      `Horizontal mapped ${formatFeet(segment.horizontal_ellipsoidal_m)}`,
      `Grid UTM ${formatFeet(segment.horizontal_grid_utm_m)}`,
      `Vertical drop added ${formatFeet(segment.vertical_drop_m ?? segment.vertical_rise_m)}`,
      segment.slope_rise_m > 0 ? `Slope rise hypotenuse ${formatFeet(segment.slope_rise_m)}` : null,
      `Ethernet cable ${formatFeet(segment.physical_cable_m)}`,
      `Slack ${formatFeet(segment.slack_m)}`,
      `Service loop ${formatFeet(segment.service_loop_m)}`,
    ].filter(Boolean).join(" · ");
    row.append(name, body);
    container.appendChild(row);
  });
  const total = document.createElement("p");
  total.className = "distance-total";
  total.textContent = `Sum of every segment: horizontal ${formatFeet(metrics.totals.horizontal_ellipsoidal_m)}; Ethernet cable ${formatFeet(metrics.totals.physical_cable_m)}. Straight chord ${formatFeet(metrics.chord_ellipsoidal_m)}. ${metrics.label}.`;
  container.appendChild(total);
}
