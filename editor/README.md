# Mountaindale local network editor

This is a planning tool for one computer. It is not a hidden page on the public map.

## Run from a checkout

```bash
node editor/server.mjs
```

Open http://127.0.0.1:8766/ . The process refuses any bind address other than loopback. Saves go to `~/.mountaindale-network/` unless you set `MOUNTAINDALE_DATA_DIR`. That folder must sit outside `network/` and `dist/`.

## Run the packaged copy

Unzip `mountaindale-local-editor.zip`, install Node.js 18 or newer, then:

```bash
./start.sh
```

On Windows, double-click `start.cmd` or run it from a command prompt. You do not need this git repository.

The package contains the public baseline, the map code, and the image tiles. It does not contain private inventory, notes, or previous saves. Those appear only after you import or edit them on this computer.

## What it edits

- Group gear that shares a place. Groups do not change links.
- Drag a marker or type longitude/latitude or an image pixel. The candidate affine is unverified.
- Draw extra vertices on a cable and set vertical rise, slack, and service loop per segment. Lengths update immediately and stay marked unverified.
- Add planned devices and planned routes. They draw in a separate style.
- Edit a public summary or replace a LAN parent on purpose. A second LAN parent is rejected.
- Write change-request notes.
- Undo, redo, save, reload, and restore a backup.

## Publishing

Review public snapshot lists as-built edits and asks you to tick the ones to include. Planned devices, planned routes, notes, and private fields are excluded even if you want them included. Validate runs an allowlist and a secret scan. Download writes a JSON file in your browser. The editor never copies that file into the public site.

A full private inventory can be imported if it is JSON with a `devices` array. Extra fields such as management addresses stay in the local plan under `local_private`.

## Calibration

Import a calibration JSON from the Inspect panel. A new affine is used immediately for approximate horizontal distances and is not published. The sampled image transform is already validated. A correlation residual, matching dimensions, or a numeric roundtrip does not mark the result as a survey. Ground accuracy stays unverified until someone records an explicit ground survey.
