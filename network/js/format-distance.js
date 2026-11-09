import { formatMetersFeet } from "./lib/distance.mjs";

export function segmentRows(metrics) {
  return metrics.segments.map((segment, index) => ({
    index,
    horizontal: formatMetersFeet(segment.horizontal_ellipsoidal_m),
    grid: formatMetersFeet(segment.horizontal_grid_utm_m),
    terrain: formatMetersFeet(segment.terrain_slope_m),
    physical: formatMetersFeet(segment.physical_cable_m),
    rise: formatMetersFeet(segment.vertical_rise_m),
    slack: formatMetersFeet(segment.slack_m),
    loop: formatMetersFeet(segment.service_loop_m),
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
      `Horizontal mapped ${formatMetersFeet(segment.horizontal_ellipsoidal_m)}`,
      `Grid UTM ${formatMetersFeet(segment.horizontal_grid_utm_m)}`,
      `Vertical drop added ${formatMetersFeet(segment.vertical_drop_m ?? segment.vertical_rise_m)}`,
      segment.slope_rise_m > 0 ? `Slope rise hypotenuse ${formatMetersFeet(segment.slope_rise_m)}` : null,
      `Terrain/physical cable ${formatMetersFeet(segment.physical_cable_m)}`,
      `Slack ${formatMetersFeet(segment.slack_m)}`,
      `Service loop ${formatMetersFeet(segment.service_loop_m)}`,
    ].filter(Boolean).join(" · ");
    row.append(name, body);
    container.appendChild(row);
  });
  const total = document.createElement("p");
  total.className = "distance-total";
  total.textContent = `Sum of every segment: horizontal ${formatMetersFeet(metrics.totals.horizontal_ellipsoidal_m)}; terrain/physical ${formatMetersFeet(metrics.totals.physical_cable_m)}. Straight chord ${formatMetersFeet(metrics.chord_ellipsoidal_m)}. ${metrics.label}.`;
  container.appendChild(total);
}
