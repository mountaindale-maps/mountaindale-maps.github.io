import { expect, test } from "@playwright/test";

async function hitTarget(page, x, y) {
  return page.evaluate(({ x, y }) => {
    const node = document.elementFromPoint(x, y);
    const marker = node?.closest?.("[data-device-id], [data-group-id], [data-cluster-id]");
    return marker?.dataset.deviceId || marker?.dataset.groupId || marker?.dataset.clusterId || "";
  }, { x, y });
}

async function realHover(page, locator, expectedId) {
  await expect(locator).toBeVisible();
  await locator.hover();
  const box = await locator.boundingBox();
  expect(box).toBeTruthy();
  const id = await hitTarget(page, box.x + box.width / 2, box.y + box.height / 2);
  expect(id).toBe(expectedId);
}

async function openMarker(page, id) {
  const direct = page.locator(`[data-device-id="${id}"]`);
  if (await direct.count()) return direct;
  const cluster = page.locator(`[data-members*="${id}"]`).first();
  await cluster.click();
  return page.locator(`[data-device-id="${id}"]`);
}

test("loads the real network, low-resolution tiles first, then a real marker click opens native tiles", async ({ page }) => {
  const tiles = [];
  page.on("request", (request) => {
    if (request.url().includes("/tiles/")) tiles.push(new URL(request.url()).pathname);
  });
  await page.goto("/network/");
  await expect(page.locator("#calib")).toContainText("Approximate horizontal distance");
  await expect(page.locator("#calib")).toContainText("ground accuracy unverified");
  await expect(page.locator("#detail")).toContainText("70 devices");
  await expect(page.locator("#detail")).toContainText("69 active");
  await expect(page.locator("#about")).not.toHaveAttribute("open");
  const visibleStatus = await page.locator("#detail").evaluate((node) => {
    const copy = node.cloneNode(true);
    copy.querySelector("#about")?.remove();
    return copy.innerText;
  });
  expect(visibleStatus).toMatch(/ground accuracy unverified/i);
  expect(visibleStatus).not.toMatch(/calibration gate/i);
  expect(visibleStatus).not.toMatch(/Open review/);
  await expect(page.locator("#map .link").first()).toBeVisible();
  await expect(page.locator("#topology")).toBeHidden();
  await page.locator("#show-network").click();
  await expect(page.locator(".uplink").first()).toBeVisible();
  await expect(page.locator(".link-key")).toContainText("Ethernet");
  await expect(page.getByText("Save locally")).toHaveCount(0);
  await expect.poll(() => page.locator("#map").getAttribute("data-tile-zoom")).not.toBe("5");
  await expect.poll(() => tiles.some((path) => /\/tiles\/[0-4]\/\d+\/\d+\.jpg$/.test(path))).toBeTruthy();
  expect(tiles.every((path) => /\/tiles\/[0-5]\/\d+\/\d+\.jpg$/.test(path))).toBeTruthy();
  expect(tiles.some((path) => /\/tiles\/5\//.test(path))).toBeFalsy();
  const marker = await openMarker(page, "045-UAP-U7O");
  await marker.click();
  await expect(page.locator("#detail")).toContainText("Selected");
  await expect(page.locator("#detail")).toContainText("Approximate horizontal distance; ground accuracy unverified");
  await expect(page.locator(".segment-row").first()).toContainText("ft");
  await expect(page.locator(".segment-row").first()).toContainText("m");
  await expect.poll(() => page.locator("#map").getAttribute("data-tile-zoom")).toBe("5");
  await expect(page.locator('#map img.tile[data-z="5"]').first()).toBeAttached();
});

test("real mouse hover highlights topology and a group hover does not invent links", async ({ page }) => {
  await page.goto("/network/");
  await expect(page.locator("#map")).toHaveAttribute("data-tile-zoom", /[0-5]/);
  const before = await page.locator("#map").getAttribute("data-tile-zoom");
  const marker = await openMarker(page, "045-UAP-U7O");
  await realHover(page, marker, "045-UAP-U7O");
  await expect(page.locator("[data-key='045-UAP-U7O']").first()).toHaveAttribute("data-hot", "1");
  await expect(page.locator("#detail")).toContainText("Highlighted");
  await expect(page.locator("#detail")).toContainText("045-UAP-U7O");
  await expect(page.locator("#map")).toHaveAttribute("data-tile-zoom", before);
  const group = page.locator("[data-group-id='site-45']");
  await realHover(page, group, "site-45");
  await expect(group).toHaveClass(/is-named/);
  await expect(page.locator("[data-device-id='045-UAP-U7O']")).toHaveClass(/is-member/);
  await expect(page.locator("#detail")).toContainText("not a connection");
  await expect(page.locator("#detail")).toContainText("045-UAP-U7O");
  await expect(page.locator("[data-key='045-UAP-U7O']").first()).toHaveAttribute("data-hot", "1");
  await expect(page.locator(".link.is-hot")).toHaveCount(0);
});

test("real clicks expand ancestor branches and show inactive gear without a path", async ({ page }) => {
  await page.goto("/network/");
  await expect(page.locator("[data-device-id='045-UAP-U7O']")).toBeVisible();
  await page.locator("#show-network").click();
  await expect(page.locator("[data-key='branch:office'] [aria-expanded='false']")).toBeVisible();
  const cluster = page.getByRole("button", { name: "2 devices at this view" }).first();
  await cluster.click();
  await expect(page.locator(".is-spread").first()).toBeVisible();
  await page.locator("#q").fill("000-UAP-IW");
  await page.locator("[data-result='000-UAP-IW']").click();
  await expect(page.locator("[data-key='branch:office'] [aria-expanded='true']")).toBeVisible();
  await expect(page.locator("[data-key='000-UAP-IW']").first()).toHaveAttribute("data-hot", "1");
  await expect(page.locator(".link.is-hot").first()).toBeVisible();
  await page.locator("#q").fill("088-UAP-M");
  await page.locator("[data-result='088-UAP-M']").click();
  await expect(page.locator("#detail")).toContainText("Inactive");
  await expect(page.locator("#detail")).toContainText("no uplink");
  await expect(page.locator("#detail .segment-row")).toHaveCount(0);
  await page.locator("#q").fill("089-UAP-IW-ROCHSTAR");
  await page.locator("[data-result='089-UAP-IW-ROCHSTAR']").click();
  await expect(page.locator("#device-path")).toContainText("089-USW-Flex-David");
  await expect(page.locator("#device-path")).toContainText("NSL5AC-AP-89");
  await expect(page.locator("#device-path")).toContainText("0000-MD-UDM-Pro-2");
  await expect(page.locator("#device-path")).toContainText("Cable");
  await expect(page.locator("#device-path")).toContainText("Wireless");
  await expect(page.locator("#device-path")).toContainText("SFP+ port");
  await expect(page.locator("#device-path")).not.toContainText("Cable type");
  await expect(page.locator(".path-note")).toHaveCount(1);
  await expect(page.locator("[data-field='mounting']")).toHaveText("Not recorded");
  await expect(page.locator("[data-field='power']")).toHaveText("Not recorded");
  await expect(page.locator("#device-details")).toContainText("Not a coverage survey");
  await expect(page.locator("#device-path")).not.toContainText("fiber");
});

test("a real touch tap highlights before a second tap zooms, and the phone layout stays on screen", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:8765/network/");
  await expect(page.locator("#topology")).toBeHidden();
  await page.locator("#show-network").tap();
  await expect(page.locator("#topology")).toBeVisible();
  const box = await page.locator("#topology").boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.locator("#show-network").tap();
  await expect(page.locator("#topology")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  const covered = await page.evaluate(() => [...document.querySelectorAll(".map-label.kind-group")].filter((label) => {
    const box = label.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) return false;
    const node = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    const owner = node?.closest?.("[data-group-id]");
    return owner && owner !== label;
  }).length);
  expect(covered).toBe(0);
  const cluster = page.locator(".cluster").first();
  await expect(cluster).toBeVisible();
  const memberId = (await cluster.getAttribute("data-members")).split(",")[0];
  await cluster.tap();
  const marker = page.locator(`[data-device-id="${memberId}"]`);
  await expect(marker).toBeVisible();
  const zoomBefore = await page.locator("#map").getAttribute("data-tile-zoom");
  await marker.tap();
  await expect(page.locator(`[data-key="${memberId}"]`).first()).toHaveAttribute("data-hot", "1");
  await expect(page.locator("#map")).toHaveAttribute("data-tile-zoom", zoomBefore);
  await marker.tap();
  await expect.poll(() => page.locator("#map").getAttribute("data-tile-zoom")).toBe("5");
  await page.locator("#fit").tap();
  const groups = page.locator(".map-label.kind-group");
  const groupCount = await groups.count();
  let touchedGroup = false;
  for (let index = 0; index < groupCount; index += 1) {
    const label = groups.nth(index);
    const box = await label.boundingBox();
    if (!box) continue;
    const id = await label.getAttribute("data-group-id");
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.dataset?.groupId || "", {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    });
    if (hit !== id) continue;
    await label.tap();
    await expect(page.locator("#detail")).toContainText("not a connection");
    touchedGroup = true;
    break;
  }
  expect(touchedGroup).toBeTruthy();
  await page.locator("#legend-btn").tap();
  await expect(page.locator("#legend")).toContainText("airMAX");
  await expect(page.locator("#legend")).toContainText("unverified");
  await context.close();
});
