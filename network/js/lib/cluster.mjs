/**
 * Screen-space clustering and spiderfy. Returned offsets are visual only.
 * Callers must keep the original coordinates on the records they passed in.
 */

export function clusterByScreen(items, radiusPx) {
  const pending = [...items];
  const clusters = [];
  while (pending.length) {
    const seed = pending.shift();
    const members = [seed];
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const other = pending[index];
      if (Math.hypot(other.x - seed.x, other.y - seed.y) <= radiusPx) {
        members.push(other);
        pending.splice(index, 1);
      }
    }
    const x = members.reduce((sum, member) => sum + member.x, 0) / members.length;
    const y = members.reduce((sum, member) => sum + member.y, 0) / members.length;
    clusters.push({
      id: members.length === 1 ? members[0].id : `cluster:${members.map((member) => member.id).sort().join("+")}`,
      members,
      x,
      y,
      clustered: members.length > 1,
    });
  }
  return clusters;
}

/** Screen-pixel offsets around a cluster. Index 0 is up. These are not coordinates. */
export function spiderfyOffsets(count, radiusPx) {
  if (count <= 1) return [{ x: 0, y: 0 }];
  const perRing = 8;
  const gap = 44;
  return Array.from({ length: count }, (_, index) => {
    const ring = Math.floor(index / perRing);
    const pos = index % perRing;
    const inRing = Math.min(perRing, count - ring * perRing);
    const radius = Math.max(radiusPx, 56) + ring * gap;
    const angle = -Math.PI / 2 + (2 * Math.PI * pos) / inRing;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}
