import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist", "mountaindale-network-preview");
const zip = path.join(root, "dist", "mountaindale-network-preview.zip");

const readme = `Mountaindale network map — standalone public preview

This package is the public viewer only. It is not a git checkout and it contains no private inventory, notes, or plans.

Start
1. Install Python 3.
2. From this folder run ./start.sh (macOS or Linux) or start.cmd (Windows).
3. Open http://127.0.0.1:8765/network/

The page is static. Distances are labeled "Approximate horizontal distance; ground accuracy unverified." The image alignment was checked. This is not a survey.

SHA256SUMS lists every file in this folder except itself. The zip file's own hash is printed when the package is built.
`;

const index = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mountaindale network preview</title>
</head>
<body>
<p><a href="network/">Open the Mountaindale network map</a></p>
<p>Approximate horizontal distance; ground accuracy unverified.</p>
</body>
</html>
`;

const startSh = `#!/bin/sh
cd "$(dirname "$0")"
echo "Open http://127.0.0.1:8765/network/"
exec python3 -m http.server 8765 --bind 127.0.0.1
`;

const startCmd = `@echo off
cd /d "%~dp0"
echo Open http://127.0.0.1:8765/network/
python -m http.server 8765 --bind 127.0.0.1
`;

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, "network"), { recursive: true });
for (const name of ["index.html", "styles.css", "js", "data", "tiles", "imagery"]) {
  await cp(path.join(root, "network", name), path.join(out, "network", name), { recursive: true });
}
await writeFile(path.join(out, "README.txt"), readme);
await writeFile(path.join(out, "index.html"), index);
await writeFile(path.join(out, "start.sh"), startSh);
await writeFile(path.join(out, "start.cmd"), startCmd);
await chmod(path.join(out, "start.sh"), 0o755);
await writeFile(path.join(out, "SHA256SUMS"), await fileSums(out));
await rm(zip, { force: true });
await new Promise((resolve, reject) => {
  const child = spawn("zip", ["-r", "-q", zip, "mountaindale-network-preview"], { cwd: path.join(root, "dist") });
  child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`zip exited ${code}`)));
});
const info = await stat(zip);
const digest = createHash("sha256").update(await readFile(zip)).digest("hex");
console.log(`Wrote ${zip} (${info.size} bytes)`);
console.log(`SHA256 ${digest}  mountaindale-network-preview.zip`);

async function fileSums(dir, base = dir) {
  const lines = [];
  for (const name of (await readdir(dir)).sort()) {
    const full = path.join(dir, name);
    const rel = path.relative(base, full);
    if (rel === "SHA256SUMS") continue;
    const info = await stat(full);
    if (info.isDirectory()) lines.push(await fileSums(full, base));
    else lines.push(`${createHash("sha256").update(await readFile(full)).digest("hex")}  ${rel.split(path.sep).join("/")}`);
  }
  return lines.filter(Boolean).join("\n") + (dir === base ? "\n" : "");
}
