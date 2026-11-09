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
  await expect(page.locator("#calib")).toHaveCount(0);
  await expect(page.locator("#detail")).toContainText("70 devices");
  await expect(page.locator("#detail")).toContainText("69 active");
  await expect(page.locator("#about")).not.toHaveAttribute("open");
  const visibleStatus = await page.locator("#detail").evaluate((node) => {
    const copy = node.cloneNode(true);
    copy.querySelector("#about")?.remove();
    return copy.innerText;
  });
  expect(visibleStatus).toMatch(/approximate, measured along the drawn route, in feet/i);
  expect(visibleStatus).not.toMatch(/WGS84|affine|UTM|geodesic/i);
  await page.locator("#about summary").click();
  await expect(page.locator("#about")).not.toContainText("affine");
  await expect(page.locator("#about")).not.toContainText("geodesic");
  await expect(page.locator("#about")).not.toContainText("UTM");
  await expect(page.locator("#about")).not.toContainText("WGS84");
  await expect(page.locator("#about")).toContainText("in feet");
  expect(visibleStatus).not.toMatch(/calibration gate/i);
  expect(visibleStatus).not.toMatch(/Open review/);
  await expect(page.locator("#map .flag")).toHaveCount(0);
  await expect(page.locator("#map .link").first()).toBeVisible();
  await expect(page.locator("#map [data-link-id='lnk:SECOM>0000-MD-UDM-Pro-2']")).toHaveCount(0);
  await expect(page.locator("#legend")).not.toContainText("SECOM WAN");
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
  await expect(page.locator("#detail")).not.toContainText("WGS84");
  await expect(page.locator("#detail")).not.toContainText("affine");
  await expect(page.locator("#detail")).not.toContainText("Grid UTM");
  await expect(page.locator("#detail")).not.toContainText("geodesic");
  await expect(page.locator(".segment-row").first()).toContainText("Along the drawn route");
  await expect(page.locator(".segment-row").first()).toContainText("ft");
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
  await expect(page.locator("#device-path")).toContainText("Wireless");
  await expect(page.locator("#device-path")).toContainText("SFP+ port");
  await expect(page.locator("#device-path")).toContainText("Ethernet cable,");
  await expect(page.locator("#device-path")).toContainText("ft");
  await expect(page.locator("#device-path")).not.toContainText("Ethernet cable length");
  await expect(page.locator("#device-path")).not.toContainText("Total Ethernet");
  await expect(page.locator("#detail")).not.toContainText("Sum");
  await expect(page.locator("#detail")).not.toContainText(/total/i);
  await expect(page.locator("#device-path")).not.toContainText("Cable type");
  await expect(page.locator(".path-note")).toHaveCount(0);
  await expect(page.locator("[data-field='mounting']")).toHaveText("Not recorded");
  await expect(page.locator("[data-field='power']")).toHaveText("Not recorded");
  await expect(page.locator("#device-details")).toContainText("Not a coverage survey");
  await expect(page.locator("#device-path")).not.toContainText("fiber");
});

test("one touch opens a device card, and the phone layout stays on screen", async ({ browser }) => {
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
  await marker.tap();
  await expect(page.locator("#detail h2")).toHaveText(memberId);
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
  await expect(page.locator("#legend")).toContainText("Cable lengths are approximate");
  await expect(page.locator("#legend")).not.toContainText("WGS84");
  await context.close();
});

test("one pointer-up opens the card on a phone without a click", async ({ browser }) => {
  const phones = [
    { viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
    { viewport: { width: 393, height: 851 }, userAgent: "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36" },
  ];
  for (const phone of phones) {
    const context = await browser.newContext({ ...phone, hasTouch: true });
    const page = await context.newPage();
    await page.goto("/network/");
    const cluster = page.locator(".cluster").first();
    await expect(cluster).toBeVisible();
    const memberId = (await cluster.getAttribute("data-members")).split(",")[0];
    await cluster.click();
    const marker = page.locator(`[data-device-id="${memberId}"]`);
    await expect(marker).toBeVisible();
    const opened = await marker.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, pointerId: 7, pointerType: "touch" };
      node.dispatchEvent(new PointerEvent("pointerdown", at));
      node.dispatchEvent(new PointerEvent("pointerup", at));
      return document.querySelector("#detail h2")?.textContent || "";
    });
    expect(opened).toBe(memberId);
    await context.close();
  }
});

test("a device marker uses its Google Earth icon at a tappable size", async ({ page }) => {
  await page.goto("/network/");
  const marker = page.locator("[data-device-id='045-UAP-U7O']");
  const icon = marker.locator("img.device-icon");
  await expect(icon).toBeVisible();
  const markerBox = await marker.boundingBox();
  const iconBox = await icon.boundingBox();
  expect(markerBox.width).toBeGreaterThanOrEqual(32);
  expect(iconBox.width).toBeGreaterThanOrEqual(20);
  expect(iconBox.width).toBeLessThanOrEqual(36);
  await page.locator("#legend-btn").click();
  const legend = page.locator("#legend");
  await expect(legend.locator("img.legend-icon").first()).toBeVisible();
  await expect(legend).toContainText("Numbered circles are groups");
  await expect(legend).toContainText("Cable lengths are approximate, measured along the drawn route, in feet.");
  await expect(legend).not.toContainText("WGS84");
  await expect(legend).not.toContainText("affine");
  const layer = await page.evaluate(() => {
    const legendBox = document.querySelector("#legend").getBoundingClientRect();
    const detailBox = document.querySelector("#detail").getBoundingClientRect();
    const overlaps = legendBox.left < detailBox.right && legendBox.right > detailBox.left && legendBox.top < detailBox.bottom && legendBox.bottom > detailBox.top;
    const color = getComputedStyle(document.querySelector("#legend")).backgroundColor;
    return { overlaps, color, icons: document.querySelectorAll("#map img.device-icon").length };
  });
  expect(layer.overlaps).toBe(false);
  expect(layer.color).toBe("rgb(22, 32, 27)");
  expect(layer.icons).toBeGreaterThan(4);
});

test("a published cable bend is drawn as more than a straight line", async ({ page }) => {
  await page.route("**/data/asbuilt_public.json", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const link = body.links.find((item) => item.id === "lnk:0000-MD-UDM-Pro-2>000-USW-24-PoE");
    const parent = body.devices.find((item) => item.id === link.parent).coords;
    const child = body.devices.find((item) => item.id === link.child).coords;
    link.vertices = [{ lon: parent.lon + 0.00035, lat: (parent.lat + child.lat) / 2 }];
    await route.fulfill({ json: body });
  });
  await page.goto("/network/");
  const points = await page.locator("[data-link-id='lnk:0000-MD-UDM-Pro-2>000-USW-24-PoE']").getAttribute("points");
  expect(points.trim().split(/\s+/).length).toBeGreaterThan(2);
});

test("the editor legend lists the same entries as the public viewer", async ({ page }) => {
  await page.goto("/network/");
  await page.locator("#legend-btn").click();
  await expect(page.locator("#legend-items")).toContainText("Wireless relay link (second hop)");
  const viewerLegend = (await page.locator("#legend-items li").allTextContents()).map((text) => text.trim());
  const viewerKey = (await page.locator("#link-key li").allTextContents()).map((text) => text.trim());
  await page.goto("http://127.0.0.1:8766/");
  await page.locator("#legend-btn").click();
  const editorLegend = (await page.locator("#legend-items li").allTextContents()).map((text) => text.trim());
  const editorKey = (await page.locator("#link-key li").allTextContents()).map((text) => text.trim());
  expect(editorLegend).toEqual(viewerLegend);
  expect(editorKey).toEqual(viewerKey);
  expect(editorKey).toContain("Wireless link from main building roof");
  expect(editorKey).toContain("Wireless relay link (second hop)");
});

test("a roof wireless hop keeps its color and a downstream relay is red", async ({ page }) => {
  await page.goto("/network/");
  await expect(page.locator("#legend")).toContainText("Wireless link from main building roof");
  await expect(page.locator("#legend")).toContainText("Wireless relay link (second hop)");
  const colors = await page.evaluate(() => {
    const stroke = (id) => getComputedStyle(document.querySelector(`#map [data-link-id="${id}"]`)).stroke;
    return {
      roof: stroke("lnk:NBM5-AP-80>NBM5-STA-80"),
      relay: stroke("lnk:NB5AC-AP-91>NS5AC-STA-91"),
      wired: stroke("lnk:0000-MD-UDM-Pro-2>000-USW-24-PoE"),
      roofHop: document.querySelector("#map [data-link-id='lnk:NBM5-AP-80>NBM5-STA-80']").dataset.hop,
      relayHop: document.querySelector("#map [data-link-id='lnk:NB5AC-AP-91>NS5AC-STA-91']").dataset.hop,
    };
  });
  expect(colors.roofHop).toBe("initial");
  expect(colors.relayHop).toBe("secondary");
  expect(colors.roof).toBe("rgb(185, 220, 255)");
  expect(colors.relay).toBe("rgb(255, 42, 42)");
  expect(colors.wired).not.toBe(colors.relay);
});

test("two-finger pinch zooms the map around the pinch midpoint", async ({ page }) => {
  await page.goto("/network/");
  await expect(page.locator("#map")).toHaveAttribute("data-scale", /.+/);
  const sourceAt = () => page.evaluate(() => {
    const map = document.querySelector("#map");
    const rect = map.getBoundingClientRect();
    const scale = Number(map.dataset.scale);
    const sx = rect.width / 2;
    const sy = rect.height / 2;
    return {
      scale,
      u: Number(map.dataset.viewU) + (sx - rect.width / 2) / scale,
      v: Number(map.dataset.viewV) + (sy - rect.height / 2) / scale,
    };
  });
  const before = await sourceAt();
  async function pinch(spread) {
    await page.evaluate((grow) => {
      const map = document.querySelector("#map");
      const rect = map.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      const midY = rect.top + rect.height / 2;
      const fire = (type, id, x, y) => {
        map.dispatchEvent(new PointerEvent(type, {
          pointerId: id,
          pointerType: "touch",
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        }));
      };
      fire("pointerdown", 11, midX - 40, midY);
      fire("pointerdown", 12, midX + 40, midY);
      const steps = 8;
      for (let step = 1; step <= steps; step += 1) {
        const gap = 40 + ((40 * grow - 40) * step) / steps;
        fire("pointermove", 11, midX - gap, midY);
        fire("pointermove", 12, midX + gap, midY);
      }
      fire("pointerup", 11, midX - 40 * grow, midY);
      fire("pointerup", 12, midX + 40 * grow, midY);
    }, spread);
  }
  await pinch(2.2);
  const zoomedIn = await sourceAt();
  expect(zoomedIn.scale).toBeGreaterThan(before.scale * 1.4);
  expect(Math.abs(zoomedIn.u - before.u)).toBeLessThan(24);
  expect(Math.abs(zoomedIn.v - before.v)).toBeLessThan(24);
  await pinch(0.45);
  const zoomedOut = await sourceAt();
  expect(zoomedOut.scale).toBeLessThan(zoomedIn.scale * 0.7);
  expect(Math.abs(zoomedOut.u - zoomedIn.u)).toBeLessThan(24);
  expect(Math.abs(zoomedOut.v - zoomedIn.v)).toBeLessThan(24);
  const outside = await page.evaluate(() => getComputedStyle(document.body).touchAction);
  expect(outside).not.toBe("none");
});

test("the legend fits on phones and tablets without clipping the last sentence", async ({ page }) => {
  const sizes = [
    [393, 851],
    [851, 393],
    [412, 915],
    [915, 412],
    [390, 844],
    [844, 390],
    [375, 667],
    [667, 375],
    [768, 1024],
    [1024, 768],
  ];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await page.goto("/network/");
    await page.locator("#legend-btn").click();
    const fit = await page.evaluate(() => {
      const legend = document.querySelector("#legend");
      const last = [...legend.querySelectorAll("p")].at(-1);
      const box = last.getBoundingClientRect();
      const panel = legend.getBoundingClientRect();
      return {
        overflow: legend.scrollHeight - legend.clientHeight,
        clipped: box.bottom > panel.bottom + 1 || box.top < panel.top - 1,
        text: last.textContent,
      };
    });
    expect(fit.overflow, `${width}x${height}`).toBeLessThanOrEqual(1);
    expect(fit.clipped, `${width}x${height}`).toBe(false);
    expect(fit.text).toContain("in feet");
  }
});
