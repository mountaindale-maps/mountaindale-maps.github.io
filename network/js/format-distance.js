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

export function cableSummary(metrics) {
  return `This cable: ${formatFeet(metrics.totals.physical_cable_m)} along the drawn route (straight line between the two ends: ${formatFeet(metrics.chord_ellipsoidal_m)}).`;
}

export function fillDistanceList(container, metrics, heading, options = {}) {
  const plain = options.plain === true;
  container.replaceChildren();
  const title = document.createElement("h3");
  title.textContent = heading || "This cable";
  container.appendChild(title);
  if (!plain && metrics.label) {
    const badge = document.createElement("p");
    badge.className = "unverified";
    badge.textContent = metrics.label;
    container.appendChild(badge);
  }
  metrics.segments.forEach((segment, index) => {
    const row = document.createElement("div");
    row.className = "segment-row";
    row.dataset.segment = String(index);
    const name = document.createElement("strong");
    name.textContent = `Piece ${index + 1} of this cable`;
    const body = document.createElement("p");
    const drop = segment.vertical_drop_m ?? segment.vertical_rise_m;
    body.textContent = (plain
      ? [
        `Along the drawn route ${formatFeet(segment.horizontal_ellipsoidal_m)}`,
        `Pole drop ${formatFeet(drop)}`,
        segment.slope_rise_m > 0 ? `Extra for the slope ${formatFeet(segment.slope_rise_m)}` : null,
        `This piece ${formatFeet(segment.physical_cable_m)}`,
        segment.slack_m > 0 ? `Slack ${formatFeet(segment.slack_m)}` : null,
        segment.service_loop_m > 0 ? `Service loop ${formatFeet(segment.service_loop_m)}` : null,
      ]
      : [
        `Horizontal mapped ${formatFeet(segment.horizontal_ellipsoidal_m)}`,
        `Grid UTM ${formatFeet(segment.horizontal_grid_utm_m)}`,
        `Vertical drop added ${formatFeet(drop)}`,
        segment.slope_rise_m > 0 ? `Slope rise hypotenuse ${formatFeet(segment.slope_rise_m)}` : null,
        `This piece ${formatFeet(segment.physical_cable_m)}`,
        `Slack ${formatFeet(segment.slack_m)}`,
        `Service loop ${formatFeet(segment.service_loop_m)}`,
      ]).filter(Boolean).join(" · ");
    row.append(name, body);
    container.appendChild(row);
  });
  const summary = document.createElement("p");
  summary.className = "distance-total";
  summary.textContent = cableSummary(metrics);
  container.appendChild(summary);
}
