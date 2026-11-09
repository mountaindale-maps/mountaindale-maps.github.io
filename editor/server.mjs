import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { buildPublicSnapshot } from "../network/js/lib/sanitize.mjs";
import { importDocument, validateImport } from "../network/js/lib/plan.mjs";
import { listBackups, loadPlan, readBackup, resolveAllowedDataDir, savePlan } from "./store.mjs";

const editorDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(editorDir, "..");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

export function editorRoots() {
  const packaged = path.join(editorDir, "public");
  if (existsSync(path.join(packaged, "index.html"))) {
    return {
      kind: "package",
      publicDir: packaged,
      baselineDir: path.join(packaged, "baseline"),
      forbidden: [packaged, path.join(repoRoot, "network"), path.join(repoRoot, "dist")],
    };
  }
  return {
    kind: "repo",
    publicDir: null,
    baselineDir: path.join(repoRoot, "network", "data"),
      forbidden: [repoRoot],
  };
}

function safeJoin(root, requestPath) {
  const clean = decodeURIComponent(requestPath.split("?")[0]);
  const relative = clean.replace(/^\/+/, "");
  const full = path.resolve(root, relative);
  const base = path.resolve(root);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

function repoFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  if (clean.startsWith("/js/lib/")) return safeJoin(path.join(repoRoot, "network", "js", "lib"), clean.slice("/js/lib/".length));
  if (clean.startsWith("/tiles/")) return safeJoin(path.join(repoRoot, "network", "tiles"), clean.slice("/tiles/".length));
  const files = {
    "/": path.join(editorDir, "static", "index.html"),
    "/index.html": path.join(editorDir, "static", "index.html"),
    "/editor.css": path.join(editorDir, "static", "editor.css"),
    "/styles.css": path.join(repoRoot, "network", "styles.css"),
    "/js/editor.js": path.join(editorDir, "static", "js", "editor.js"),
    "/js/map.js": path.join(repoRoot, "network", "js", "map.js"),
    "/js/topology-view.js": path.join(repoRoot, "network", "js", "topology-view.js"),
    "/js/format-distance.js": path.join(repoRoot, "network", "js", "format-distance.js"),
  };
  return files[clean] || null;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8_000_000) {
      const error = new Error("Body is too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response, status, body, type = "application/json; charset=utf-8") {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  response.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(payload);
}

function originAllowed(request, port) {
  const origin = request.headers.origin;
  if (!origin) return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

function hostAllowed(request, port) {
  const raw = request.headers.host;
  if (!raw || Array.isArray(raw)) return false;
  const host = String(raw).toLowerCase();
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

export async function startEditorServer(options = {}) {
  const roots = options.roots || editorRoots();
  const dataDir = await resolveAllowedDataDir(
    options.dataDir || path.join(os.homedir(), ".mountaindale-network"),
    roots.forbidden,
  );
  const host = "127.0.0.1";
  const baseline = () => readJson(path.join(roots.baselineDir, "asbuilt_public.json"));
  const topology = () => readJson(path.join(roots.baselineDir, "topology_hierarchy.json"));
  const metadata = () => readJson(path.join(roots.baselineDir, "metadata.json"));

  const server = createServer(async (request, response) => {
    try {
      const port = server.address().port;
      if (!hostAllowed(request, port)) {
        send(response, 403, { error: "This editor only answers on localhost" });
        return;
      }
      if (!originAllowed(request, port)) {
        send(response, 403, { error: "Cross-origin write is refused" });
        return;
      }
      const url = new URL(request.url, `http://127.0.0.1:${port}`);
      if (url.pathname.startsWith("/api/")) {
        if (request.method === "GET" && url.pathname === "/api/health") {
          send(response, 200, {
            ok: true,
            host,
            port,
            loopback: true,
            dataDir,
            publicWrite: false,
            kind: roots.kind,
          });
          return;
        }
        if (request.method === "GET" && url.pathname === "/api/baseline") return send(response, 200, baseline());
        if (request.method === "GET" && url.pathname === "/api/topology") return send(response, 200, topology());
        if (request.method === "GET" && url.pathname === "/api/metadata") return send(response, 200, metadata());
        if (request.method === "GET" && url.pathname === "/api/state") return send(response, 200, { plan: await loadPlan(dataDir) });
        if (request.method === "PUT" && url.pathname === "/api/state") {
          const plan = await readBody(request);
          validateImport(plan);
          const saved = await savePlan(dataDir, plan, roots.forbidden);
          return send(response, 200, { ok: true, backup: saved.backup ? path.basename(saved.backup) : null });
        }
        if (request.method === "GET" && url.pathname === "/api/backups") return send(response, 200, { backups: await listBackups(dataDir) });
        if (request.method === "POST" && url.pathname === "/api/restore") {
          const body = await readBody(request);
          const plan = await readBackup(dataDir, body.name);
          return send(response, 200, { plan });
        }
        if (request.method === "POST" && url.pathname === "/api/import") {
          const body = await readBody(request);
          const plan = importDocument(body.document, metadata());
          return send(response, 200, { plan });
        }
        if (request.method === "POST" && url.pathname === "/api/export") {
          const body = await readBody(request);
          const result = buildPublicSnapshot(baseline(), body.plan, body.selection);
          return send(response, 200, result);
        }
        return send(response, 404, { error: "Unknown API" });
      }
      if (request.method !== "GET" && request.method !== "HEAD") return send(response, 405, { error: "Method not allowed" });
      const file = roots.publicDir ? safeJoin(roots.publicDir, url.pathname === "/" ? "/index.html" : url.pathname) : repoFile(url.pathname);
      if (!file || !existsSync(file) || !statSync(file).isFile()) return send(response, 404, "Not found", "text/plain; charset=utf-8");
      const type = TYPES[path.extname(file).toLowerCase()];
      if (!type) return send(response, 404, "Not found", "text/plain; charset=utf-8");
      const bytes = await readFile(file);
      send(response, 200, bytes, type);
    } catch (error) {
      const known = new Set(["SANITIZER", "REVIEW_REQUIRED", "SCHEMA", "DUAL_UPLINK", "CYCLE", "IMPORT", "PLANNED_EXCLUDED"]);
      if (error.code === "BACKUP") return send(response, 400, { error: "Unknown backup", code: "BACKUP" });
      if (error.code === "DATA_DIR") return send(response, 400, { error: "Refusing to store plans inside public files", code: "DATA_DIR" });
      if (known.has(error.code)) {
        return send(response, error.status || 400, { error: error.message, code: error.code, findings: error.findings || null });
      }
      send(response, error.status || 500, { error: "The editor could not complete that request", code: "ERROR" });
    }
  });

  await new Promise((resolve) => server.listen(options.port ?? 8766, host, resolve));
  return { server, host, port: server.address().port, dataDir, roots };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const started = await startEditorServer({
    port: Number(process.env.PORT || 8766),
    dataDir: process.env.MOUNTAINDALE_DATA_DIR || undefined,
  });
  console.log(`Mountaindale local editor at http://${started.host}:${started.port}/`);
  console.log(`Plans stay in ${started.dataDir}`);
  console.log("Loopback only. Nothing is published.");
}
