import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { evaluateCalibration, importCalibration } from "../network/js/lib/calibration.mjs";
import { JPEG_CANDIDATE_GEOTRANSFORM, ORIGINAL_GEOTRANSFORM } from "../network/js/lib/projection.mjs";

const metadata = JSON.parse(readFileSync(new URL("../network/data/metadata.json", import.meta.url)));
const registration = JSON.parse(readFileSync(new URL("../network/data/registration_summary.json", import.meta.url)));
function piece(...parts) {
  return parts.join("");
}
const banned = [
  new RegExp(piece("/home/", "dh", "enken")),
  new RegExp(piece("/workspace/", "mountain", "dale")),
  new RegExp(piece("drone_sd", "_MD_map")),
  new RegExp(piece("127", "707", ".txt")),
  new RegExp(piece("c3b43", "fcf")),
];

function walk(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (/\.(json|md|html|js|mjs)$/.test(name)) found.push(full);
  }
  return found;
}

test("public readiness flags stay split between image transform and survey", () => {
  assert.equal(metadata.image_transform_validated, true);
  assert.equal(metadata.horizontal_estimates_ready, true);
  assert.equal(metadata.safe_for_authoritative_measurement, false);
  assert.equal(metadata.survey_accuracy_validated, false);
  assert.equal(metadata.readiness, "READY_FOR_APPROXIMATE_HORIZONTAL_CABLE_ESTIMATES_NOT_SURVEY");
  assert.equal(registration.accepted, 32);
  assert.equal(registration.rejected, 1);
  assert.equal(registration.holdout_expected_resize_residual_jpeg_px.n, 16);
  assert.equal(registration.rejected_check.jpeg_xy[0], 762);
  assert.equal(registration.rejected_check.jpeg_xy[1], 7094);
  const claim = evaluateCalibration(metadata);
  assert.equal(claim.distanceLabel, "Approximate horizontal distance; ground accuracy unverified");
  assert.equal(claim.safe_for_authoritative_measurement, false);
  assert.match(claim.banner, /not a survey/i);
});

test("horizontal and vertical affine scales are independent", () => {
  const gt = metadata.candidate_georeferencing.gdal_geotransform;
  assert.deepEqual(gt, [...JPEG_CANDIDATE_GEOTRANSFORM]);
  assert.notEqual(gt[1], Math.abs(gt[5]));
  assert.equal(gt[1], 0.08311041491526702);
  assert.equal(gt[5], -0.08311084179364896);
  const widthOnlyHeight = 22008 * (8000 / 16623);
  assert.ok(Math.abs(widthOnlyHeight - 10591.5899657) < 1e-4);
  assert.ok(Math.abs(gt[1] - ORIGINAL_GEOTRANSFORM[1] * (16623 / 8000)) < 1e-12);
  assert.ok(Math.abs(gt[5] - ORIGINAL_GEOTRANSFORM[5] * (22008 / 10592)) < 1e-12);
  assert.deepEqual(metadata.candidate_georeferencing.native_preview_m_per_pixel, [gt[1], Math.abs(gt[5])]);
});

test("public calibration files do not carry private workstation paths", () => {
  const files = [
    ...walk("network/data"),
    ...walk("network").filter((file) => file.endsWith("README.md") || file.endsWith("index.html")),
    "editor/README.md",
  ];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const pattern of banned) assert.equal(pattern.test(text), false, `${file} matches ${pattern}`);
  }
});

test("importing image-transform evidence does not promote it to a survey", () => {
  const raw = {
    ...metadata,
    safe_for_authoritative_measurement: true,
    numeric_roundtrip_ok: true,
    source_path: piece("/", "home", "/", "dh", "enken", "/private/", "odm_ortho", "photo.tif"),
    accuracy: { jpeg_to_geotiff_registration_residual_px: { rmse: 0.053 } },
  };
  const imported = importCalibration(metadata, raw);
  assert.equal(imported.safe_for_authoritative_measurement, false);
  assert.equal(imported.survey_accuracy_validated, false);
  assert.equal(imported.image_transform_validated, true);
  assert.equal(imported.horizontal_estimates_ready, true);
  assert.equal(JSON.stringify(imported).includes(piece("/home/", "dh", "enken")), false);
  assert.equal(evaluateCalibration(imported).distanceLabel, "Approximate horizontal distance; ground accuracy unverified");
  assert.deepEqual(imported.candidate_georeferencing.gdal_geotransform, metadata.candidate_georeferencing.gdal_geotransform);
});
