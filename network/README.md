# Mountaindale network map

Public as-built viewer for the Oct 31 aerial and the Relay equipment export. The page is static and is meant to be served by GitHub Pages at `/network/`. It is not deployed from this branch until it is reviewed.

The 3D model stays at `/` and `/mesh.html`. Those URLs are unchanged.

## What is public

`network/data/asbuilt_public.json` and `network/data/topology_hierarchy.json` are the sanitized Relay dataset: 70 devices, 72 links, 22 location groups. Management addresses, radio MACs, serials, power, conduit, private notes, provider pricing, and unpublished plans are not in these files. The two family Starlink services are labelled only as “Private family network”.

## Imagery

Tiles in `network/tiles/{z}/{x}/{y}.jpg` are an image-local pyramid of `orthophoto_8000px.jpg` (SHA256 `0d4567a7ff0a6009b42c8c43fc8c5e588dabc903ae7ad17a20070bfe78bad8ad`, 8000×10592). Zoom 6 is native. They are not Web Mercator XYZ tiles. Rebuild them with:

```bash
python3 scripts/build_tiles.py
```

## Calibration

`network/data/metadata.json` is the public calibration record. `image_transform_validated` and `horizontal_estimates_ready` are true. `safe_for_authoritative_measurement` and `survey_accuracy_validated` stay false.

An independent read-only comparison of the original GeoTIFF and the hash-identical JPEG accepted 32 distributed patches, 16 of them held out from fitting. That supports the deterministic full-frame resize. Horizontal and vertical scales are independent: the GeoTIFF pixel scales are not multiplied by one shared ratio. The public affine is exactly `[504080.16032596945, 0.08311041491526702, 0, 4271568.686183937, 0, -0.08311084179364896]`.

The viewer labels lengths **Approximate horizontal distance; ground accuracy unverified**. Each segment is a WGS84 geodesic. Feet are metres ÷ 0.3048. Grid UTM length is separate. Slope, slack, vertical rise, and service loops are separate and are not folded into the horizontal figure. Correlation residuals are not a ground-error bound. No positional accuracy number is claimed.

One patch at JPEG (762, 7094) failed the acceptance test (NCC 0.819, residual about 4.69 JPEG pixels). Its cause is not established. Extreme boundary and nodata areas were not fully sampled. There is no coverage mask and no surveyed control. The sanitized registration summary is `network/data/registration_summary.json`. Local filesystem paths are not in the public files.

A later ground survey can be imported in the local editor. That import does not publish, and an image residual or a numeric roundtrip does not open the survey gate.

## Local editor

Generic editor source lives in `editor/`. It binds to `127.0.0.1` only. Plans, notes, and saves go to `~/.mountaindale-network/` (or `MOUNTAINDALE_DATA_DIR`), which is outside this site. The public snapshot is a download produced after an explicit review. Planned records are always excluded. See `editor/README.md`.

## Commands

```bash
python3 -m http.server 8765 --bind 127.0.0.1
# open http://127.0.0.1:8765/network/

npm test
npm run test:browser
node editor/server.mjs
node scripts/package_editor.mjs
```

## Limitations

- The sampled image transform is validated. Ground accuracy is not. Do not treat distances as a survey or treat correlation residuals as a geographic error bound.
- One registration patch was rejected, and the outer boundary was not fully sampled.
- Live Google Earth has not been re-exported. Site 96 pins are unresolved and were not moved. 049-USW-Flex altitude is null. Raw KML altitudes are not mount heights.
- As-built map lines are straight pin-to-pin segments. The public file has no trench geometry.
- Overlapping markers spread in screen space only.
- This branch does not publish GitHub Pages and does not merge.
