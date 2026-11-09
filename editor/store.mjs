import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, readFile, readdir, realpath, open, rename, lstat, unlink } from "node:fs/promises";
import path from "node:path";

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const CREATE_FLAGS = constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | NOFOLLOW;
const READ_FLAGS = constants.O_RDONLY | NOFOLLOW;
const DIR_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | NOFOLLOW;

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

function dataDirError() {
  const error = new Error("Refusing to store plans outside the allowed directory");
  error.code = "DATA_DIR";
  return error;
}

function backupError() {
  const error = new Error("Unknown backup");
  error.code = "BACKUP";
  return error;
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

function safeName(name) {
  if (typeof name !== "string" || name.length === 0 || name.length > 180) throw dataDirError();
  if (name.includes("/") || name.includes("\\") || name.includes("\0") || name === "." || name === "..") throw dataDirError();
  return name;
}

function entryPath(dirHandle, root, name) {
  const entry = safeName(name);
  if (process.platform === "linux") return `/proc/self/fd/${dirHandle.fd}/${entry}`;
  return path.join(root, entry);
}

async function openAllowedDir(root) {
  const handle = await open(root, DIR_FLAGS);
  try {
    const info = await handle.stat();
    if (!info.isDirectory()) throw dataDirError();
    if (process.platform === "linux") {
      const via = await realpath(`/proc/self/fd/${handle.fd}`);
      if (via !== root) throw dataDirError();
    } else {
      const listed = await lstat(root);
      if (listed.isSymbolicLink() || listed.ino !== info.ino || listed.dev !== info.dev) throw dataDirError();
    }
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function lstatEntry(dirHandle, root, name) {
  try {
    return await lstat(entryPath(dirHandle, root, name));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function assertSameFile(dirHandle, root, name, handle) {
  const info = await handle.stat();
  const named = await lstatEntry(dirHandle, root, name);
  if (!info.isFile() || info.nlink < 1 || !named || !named.isFile() || named.isSymbolicLink() || named.ino !== info.ino || named.dev !== info.dev) {
    throw dataDirError();
  }
  if (process.platform === "linux") {
    let located;
    try {
      located = await realpath(`/proc/self/fd/${handle.fd}`);
    } catch (error) {
      if (error.code === "ENOENT") throw dataDirError();
      throw error;
    }
    if (path.basename(located) !== name || !contained(located, root)) throw dataDirError();
  }
  return info;
}

async function createExclusive(dirHandle, root, name) {
  let handle;
  try {
    handle = await open(entryPath(dirHandle, root, name), CREATE_FLAGS, 0o600);
  } catch (error) {
    if (error.code === "EEXIST" || error.code === "ELOOP" || error.code === "ENOTDIR") throw dataDirError();
    throw error;
  }
  try {
    await assertSameFile(dirHandle, root, name, handle);
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function discardIfOurs(dirHandle, root, name, handle) {
  try {
    const info = await handle.stat();
    const named = await lstatEntry(dirHandle, root, name);
    if (named && named.isFile() && !named.isSymbolicLink() && named.ino === info.ino && named.dev === info.dev) {
      await unlink(entryPath(dirHandle, root, name));
    }
  } catch {
    // The exclusive file is already gone or was never installed.
  }
}

async function ensureRealSubdir(dirHandle, root, name) {
  const existing = await lstatEntry(dirHandle, root, name);
  if (existing?.isSymbolicLink() || (existing && !existing.isDirectory())) throw dataDirError();
  if (!existing) {
    try {
      await mkdir(entryPath(dirHandle, root, name));
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  const info = await lstatEntry(dirHandle, root, name);
  if (!info || info.isSymbolicLink() || !info.isDirectory()) throw dataDirError();
  const sub = await open(entryPath(dirHandle, root, name), DIR_FLAGS);
  try {
    const stat = await sub.stat();
    if (!stat.isDirectory() || stat.ino !== info.ino || stat.dev !== info.dev) throw dataDirError();
    if (process.platform === "linux") {
      const via = await realpath(`/proc/self/fd/${sub.fd}`);
      if (via !== path.join(root, name)) throw dataDirError();
    }
  } finally {
    await sub.close();
  }
}

async function readRegular(dirHandle, root, name) {
  let handle;
  try {
    handle = await open(entryPath(dirHandle, root, name), READ_FLAGS);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error.code === "ELOOP" || error.code === "EEXIST") throw dataDirError();
    throw error;
  }
  try {
    await assertSameFile(dirHandle, root, name, handle);
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

async function writeExclusive(dirHandle, root, name, contents) {
  const handle = await createExclusive(dirHandle, root, name);
  try {
    await handle.writeFile(contents);
    await handle.sync();
    await assertSameFile(dirHandle, root, name, handle);
    return handle;
  } catch (error) {
    await discardIfOurs(dirHandle, root, name, handle);
    await handle.close();
    throw error;
  }
}

function backupName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${randomBytes(6).toString("hex")}.json`;
}

async function ensureDataDir(root) {
  try {
    const info = await lstat(root);
    if (info.isSymbolicLink() || !info.isDirectory()) throw dataDirError();
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const parent = path.dirname(root);
  const name = path.basename(root);
  const parentInfo = await lstat(parent);
  if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory()) throw dataDirError();
  const parentReal = await realpath(parent);
  if (path.join(parentReal, name) !== root) throw dataDirError();
  try {
    await mkdir(root);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const created = await lstat(root);
  if (created.isSymbolicLink() || !created.isDirectory()) throw dataDirError();
}

export async function savePlan(dataDir, plan, forbiddenRoots) {
  const root = await resolveAllowedDataDir(dataDir, forbiddenRoots);
  await ensureDataDir(root);
  const dir = await openAllowedDir(root);
  try {
    await ensureRealSubdir(dir, root, "backups");
    const payload = `${JSON.stringify(plan, null, 2)}\n`;
    let backup = null;
    const currentInfo = await lstatEntry(dir, root, "current.json");
    if (currentInfo?.isSymbolicLink()) {
      // rename below replaces the directory entry and does not follow it.
    } else if (currentInfo?.isFile()) {
      const previous = await readRegular(dir, root, "current.json");
      const sub = await open(entryPath(dir, root, "backups"), DIR_FLAGS);
      try {
        const via = process.platform === "linux" ? await realpath(`/proc/self/fd/${sub.fd}`) : path.join(root, "backups");
        if (via !== path.join(root, "backups")) throw dataDirError();
        let stored = null;
        for (let attempt = 0; attempt < 5 && !stored; attempt += 1) {
          const name = backupName();
          try {
            stored = await writeExclusive(sub, via, name, previous);
            backup = path.join(root, "backups", name);
          } catch (error) {
            if (error.code !== "DATA_DIR") throw error;
          }
        }
        if (!stored) throw dataDirError();
        await stored.close();
      } finally {
        await sub.close();
      }
    } else if (currentInfo) {
      throw dataDirError();
    }

    let installedOk = false;
    for (let attempt = 0; attempt < 5 && !installedOk; attempt += 1) {
      const tmpName = `current.json.${randomBytes(16).toString("hex")}.tmp`;
      let installed = null;
      try {
        installed = await writeExclusive(dir, root, tmpName, payload);
      } catch (error) {
        if (error.code !== "DATA_DIR") throw error;
        continue;
      }
      try {
        try {
          await rename(entryPath(dir, root, tmpName), entryPath(dir, root, "current.json"));
        } catch (error) {
          if (error.code === "ENOENT" || error.code === "ELOOP" || error.code === "ENOTDIR") throw dataDirError();
          throw error;
        }
        await assertSameFile(dir, root, "current.json", installed);
        await dir.sync();
        installedOk = true;
      } catch (error) {
        await discardIfOurs(dir, root, tmpName, installed);
        if (error.code !== "DATA_DIR" && error.code !== "ENOENT") throw error;
      } finally {
        await installed.close();
      }
    }
    if (!installedOk) throw dataDirError();
    return { dataDir: root, backup, file: path.join(root, "current.json") };
  } finally {
    await dir.close();
  }
}

export async function loadPlan(dataDir) {
  const root = await resolveReal(dataDir);
  try {
    const info = await lstat(root);
    if (info.isSymbolicLink() || !info.isDirectory()) throw dataDirError();
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const dir = await openAllowedDir(root);
  try {
    let text;
    try {
      text = await readRegular(dir, root, "current.json");
    } catch (error) {
      if (error.code !== "DATA_DIR") throw error;
      const info = await lstatEntry(dir, root, "current.json");
      if (info?.isSymbolicLink()) throw error;
      throw error;
    }
    if (text == null) return null;
    try {
      return JSON.parse(text);
    } catch (error) {
      if (error instanceof SyntaxError) {
        const refused = new Error("The saved plan could not be read. Restore a backup explicitly. The unreadable file was left in place.");
        refused.code = "PLAN_CORRUPT";
        refused.backups = await listBackups(root);
        throw refused;
      }
      throw error;
    }
  } finally {
    await dir.close();
  }
}

export async function listBackups(dataDir) {
  const root = await resolveReal(dataDir);
  const dir = path.join(root, "backups");
  try {
    const real = await resolveReal(dir);
    if (!contained(real, root)) return [];
    const names = await readdir(real);
    return names.filter((name) => name.endsWith(".json")).sort().reverse();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

const BACKUP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,160}\.json$/;

export async function readBackup(dataDir, name) {
  if (typeof name !== "string" || !BACKUP_NAME.test(name) || name.includes("..")) throw backupError();
  const root = await resolveReal(dataDir);
  const dir = await openAllowedDir(root);
  try {
    const info = await lstatEntry(dir, root, "backups");
    if (!info || info.isSymbolicLink() || !info.isDirectory()) throw backupError();
    const sub = await open(entryPath(dir, root, "backups"), DIR_FLAGS);
    try {
      const via = process.platform === "linux" ? await realpath(`/proc/self/fd/${sub.fd}`) : path.join(root, "backups");
      if (via !== path.join(root, "backups")) throw dataDirError();
      const text = await readRegular(sub, via, name);
      if (text == null) throw backupError();
      try {
        return JSON.parse(text);
      } catch (error) {
        if (error instanceof SyntaxError) throw backupError();
        throw error;
      }
    } finally {
      await sub.close();
    }
  } finally {
    await dir.close();
  }
}
