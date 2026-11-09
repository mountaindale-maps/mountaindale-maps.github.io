import { mkdir, readFile, copyFile, access, readdir, realpath, open, rename } from "node:fs/promises";
import path from "node:path";

function contained(child, parent) {
  const left = path.resolve(child);
  const right = path.resolve(parent);
  return left === right || left.startsWith(right + path.sep);
}

function refusePublic(resolved, forbiddenRoots) {
  for (const root of forbiddenRoots) {
    if (contained(resolved, root)) {
      const error = new Error("Refusing to store plans inside public files");
      error.code = "DATA_DIR";
      throw error;
    }
  }
}

async function resolveReal(target) {
  const absolute = path.resolve(target);
  const pending = [];
  let cursor = absolute;
  while (true) {
    try {
      const real = await realpath(cursor);
      return pending.length ? path.resolve(real, ...pending) : real;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      pending.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

export function assertDataDirAllowed(dataDir, forbiddenRoots) {
  const resolved = path.resolve(dataDir);
  refusePublic(resolved, forbiddenRoots.map((root) => path.resolve(root)));
  return resolved;
}

export async function resolveAllowedDataDir(dataDir, forbiddenRoots) {
  const resolved = await resolveReal(dataDir);
  const forbidden = [];
  for (const root of forbiddenRoots) {
    try {
      forbidden.push(await resolveReal(root));
    } catch {
      forbidden.push(path.resolve(root));
    }
  }
  refusePublic(resolved, forbidden);
  return resolved;
}

export async function savePlan(dataDir, plan, forbiddenRoots) {
  const root = await resolveAllowedDataDir(dataDir, forbiddenRoots);
  await mkdir(path.join(root, "backups"), { recursive: true });
  const current = path.join(root, "current.json");
  let backup = null;
  try {
    await access(current);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backup = path.join(root, "backups", `${stamp}.json`);
    await copyFile(current, backup);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const tmp = `${current}.tmp`;
  const handle = await open(tmp, "w");
  try {
    await handle.writeFile(`${JSON.stringify(plan, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, current);
  return { dataDir: root, backup, file: current };
}

export async function loadPlan(dataDir) {
  try {
    return JSON.parse(await readFile(path.join(dataDir, "current.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function listBackups(dataDir) {
  const dir = path.join(dataDir, "backups");
  try {
    const names = await readdir(dir);
    return names.filter((name) => name.endsWith(".json")).sort().reverse();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

const BACKUP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,160}\.json$/;

export async function readBackup(dataDir, name) {
  if (typeof name !== "string" || !BACKUP_NAME.test(name) || name.includes("..")) {
    const error = new Error("Unknown backup");
    error.code = "BACKUP";
    throw error;
  }
  const root = await resolveReal(dataDir);
  const full = path.resolve(root, "backups", name);
  if (!contained(full, path.join(root, "backups"))) {
    const error = new Error("Unknown backup");
    error.code = "BACKUP";
    throw error;
  }
  try {
    return JSON.parse(await readFile(full, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR" || error instanceof SyntaxError) {
      const refused = new Error("Unknown backup");
      refused.code = "BACKUP";
      throw refused;
    }
    throw error;
  }
}
