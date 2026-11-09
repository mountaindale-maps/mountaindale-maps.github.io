/** The SECOM pin-to-router stroke is not drawn. The WAN record itself stays in the data. */
export function shownOnMap(link) {
  if (!link) return false;
  if (link.medium === "wan" && link.parent === "SECOM") return false;
  if (link.id === "lnk:SECOM>0000-MD-UDM-Pro-2") return false;
  return true;
}
