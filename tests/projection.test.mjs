import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  IMAGE_HEIGHT,
  IMAGE_WIDTH,
  FULL_JPEG_GEOTRANSFORM,
  JPEG_CANDIDATE_GEOTRANSFORM,
  ORIGINAL_GEOTRANSFORM,
  imageToLonLat,
  imageToUtm,
  lonLatToImage,
  lonLatToUtm13n,
  utm13nToLonLat,
  utmToImage,
  webMercatorTileIndex,
} from "../network/js/lib/projection.mjs";
import { imageTileIndex } from "../network/js/lib/tiles.mjs";

const golden = JSON.parse(readFileSync(new URL("./fixtures/geodesy_golden.json", import.meta.url)));
const metadata = JSON.parse(readFileSync(new URL("../network/data/metadata.json", import.meta.url)));

test("display affine is the registered crop, and the full frame keeps its own scale", () => {
  assert.deepEqual(metadata.candidate_georeferencing.gdal_geotransform, [...JPEG_CANDIDATE_GEOTRANSFORM]);
  assert.deepEqual(metadata.full_jpeg.gdal_geotransform, [...FULL_JPEG_GEOTRANSFORM]);
  assert.equal(metadata.imagery.width, IMAGE_WIDTH);
  assert.equal(metadata.imagery.height, IMAGE_HEIGHT);
  assert.equal(metadata.imagery.sha256, "d14b661ef72be0bc94018a8fe5fe2dc77ce41841a3e5bc0f5fb05386fcca0b27");
  assert.equal(metadata.safe_for_authoritative_measurement, false);
  assert.notEqual(JPEG_CANDIDATE_GEOTRANSFORM[2], 0);
  assert.notEqual(JPEG_CANDIDATE_GEOTRANSFORM[4], 0);
  const scaleX = (16623 / 8000) * ORIGINAL_GEOTRANSFORM[1];
  const scaleY = (22008 / 10592) * ORIGINAL_GEOTRANSFORM[5];
  assert.ok(Math.abs(scaleX - FULL_JPEG_GEOTRANSFORM[1]) < 1e-12);
  assert.ok(Math.abs(scaleY - FULL_JPEG_GEOTRANSFORM[5]) < 1e-12);
});

test("JPEG corners roundtrip through UTM and match pyproj lon/lat", () => {
  for (const corner of golden.jpeg_corners_ul_ur_lr_ll) {
    const [easting, northing] = imageToUtm(corner.u, corner.v, FULL_JPEG_GEOTRANSFORM);
    assert.ok(Math.abs(easting - corner.easting) < 1e-6);
    assert.ok(Math.abs(northing - corner.northing) < 1e-6);
    const [lon, lat] = imageToLonLat(corner.u, corner.v, FULL_JPEG_GEOTRANSFORM);
    assert.ok(Math.abs(lon - corner.lon) < 1e-8, `lon ${lon} vs ${corner.lon}`);
    assert.ok(Math.abs(lat - corner.lat) < 1e-8, `lat ${lat} vs ${corner.lat}`);
    const [u, v] = lonLatToImage(lon, lat, FULL_JPEG_GEOTRANSFORM);
    // Series residual against PROJ is about 0.12 mm here, under 0.002 image pixel.
    assert.ok(Math.abs(u - corner.u) < 2e-3);
    assert.ok(Math.abs(v - corner.v) < 2e-3);
    const [backLon, backLat] = utm13nToLonLat(easting, northing);
    assert.ok(Math.abs(backLon - lon) < 1e-10);
    assert.ok(Math.abs(backLat - lat) < 1e-10);
  }
});

test("UDM geographic position roundtrips to the same image pixel", () => {
  const [fullU, fullV] = lonLatToImage(golden.udm.lon, golden.udm.lat, FULL_JPEG_GEOTRANSFORM);
  assert.ok(Math.abs(fullU - golden.udm.u) < 2e-3);
  assert.ok(Math.abs(fullV - golden.udm.v) < 2e-3);
  const [u, v] = lonLatToImage(golden.udm.lon, golden.udm.lat);
  const [lon, lat] = imageToLonLat(u, v);
  assert.ok(Math.abs(lon - golden.udm.lon) < 1e-9);
  assert.ok(Math.abs(lat - golden.udm.lat) < 1e-9);
  const [easting, northing] = lonLatToUtm13n(golden.udm.lon, golden.udm.lat);
  assert.ok(Math.abs(easting - golden.udm.easting) < 2e-4);
  assert.ok(Math.abs(northing - golden.udm.northing) < 2e-4);
});

test("original GeoTIFF sample uses its own affine, not the JPEG affine", () => {
  const sample = golden.original_sample;
  const [easting, northing] = imageToUtm(sample.u, sample.v, ORIGINAL_GEOTRANSFORM);
  assert.ok(Math.abs(easting - sample.easting) < 1e-6);
  assert.ok(Math.abs(northing - sample.northing) < 1e-6);
  const [lon, lat] = utm13nToLonLat(easting, northing);
  assert.ok(Math.abs(lon - sample.lon) < 1e-8);
  assert.ok(Math.abs(lat - sample.lat) < 1e-8);
  const [u, v] = utmToImage(easting, northing, ORIGINAL_GEOTRANSFORM);
  assert.ok(Math.abs(u - sample.u) < 1e-6);
  assert.ok(Math.abs(v - sample.v) < 1e-6);
  const jpeg = imageToUtm(sample.u, sample.v, FULL_JPEG_GEOTRANSFORM);
  assert.ok(Math.abs(jpeg[0] - easting) > 1);
});

test("image tiles are not web-mercator XYZ tiles", () => {
  const [u, v] = lonLatToImage(golden.udm.lon, golden.udm.lat);
  const tile = imageTileIndex(u, v, 5);
  const slippy = webMercatorTileIndex(golden.udm.lon, golden.udm.lat, 6);
  assert.equal(tile.scheme, "IMAGE_LOCAL_NOT_GEOGRAPHIC_XYZ");
  assert.notEqual(`${tile.x}/${tile.y}`, `${slippy.x}/${slippy.y}`);
  assert.deepEqual(imageTileIndex(0, 0, 5), { z: 5, x: 0, y: 0, scheme: "IMAGE_LOCAL_NOT_GEOGRAPHIC_XYZ" });
  assert.equal(imageTileIndex(256, 10, 5).x, 1);
  assert.equal(imageTileIndex(600, 10, 4).x, 1);
});
