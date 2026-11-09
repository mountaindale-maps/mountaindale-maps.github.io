import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist", "mountaindale-local-editor");
const zip = path.join(root, "dist", "mountaindale-local-editor.zip");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const copies = [
  ["editor/server.mjs", "editor/server.mjs"],
  ["editor/store.mjs", "editor/store.mjs"],
  ["editor/README.md", "editor/README.md"],
  ["editor/start.sh", "start.sh"],
  ["editor/start.cmd", "start.cmd"],
  ["editor/static", "editor/static"],
  ["network/js", "network/js"],
  ["network/styles.css", "network/styles.css"],
  ["network/data", "network/data"],
  ["network/tiles", "network/tiles"],
  ["network/imagery", "network/imagery"],
  ["network/README.md", "network/README.md"],
];
for (const [from, to] of copies) {
  await cp(path.join(root, from), path.join(out, to), { recursive: true });
}
await writeFile(path.join(out, "SHA256SUMS"), await fileSums(out));
await rm(zip, { force: true });
await new Promise((resolve, reject) => {
  const child = spawn("zip", ["-r", "-q", zip, "mountaindale-local-editor"], { cwd: path.join(root, "dist") });
  child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`zip exited ${code}`)));
});
const info = await stat(zip);
const digest = createHash("sha256").update(await readFile(zip)).digest("hex");
console.log(`Wrote ${zip} (${info.size} bytes)`);
console.log(`SHA256 ${digest}  mountaindale-local-editor.zip`);

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
