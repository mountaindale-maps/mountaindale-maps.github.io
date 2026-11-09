/** Editor-only quality notes. They are merged onto the working baseline and never published. */
export function mergeQualityFlags(baseline, flags) {
  const extras = new Map((flags?.devices || []).map((device) => [device.id, device]));
  if (!extras.size) return baseline;
  return {
    ...baseline,
    devices: (baseline.devices || []).map((device) => {
      const extra = extras.get(device.id);
      if (!extra) return device;
      const next = { ...device };
      if (Array.isArray(extra.data_quality)) next.data_quality = extra.data_quality;
      if (extra.service_area_tag && typeof extra.service_area_tag === "object") next.service_area_tag = extra.service_area_tag;
      return next;
    }),
  };
}
