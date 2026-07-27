import fs from "node:fs/promises";
import path from "node:path";

export async function hasGitMetadata(cwd: string | null | undefined) {
  if (typeof cwd !== "string" || cwd.trim().length === 0) return false;
  return fs
    .lstat(path.resolve(cwd.trim(), ".git"))
    .then((entry) => entry.isDirectory() || entry.isFile())
    .catch(() => false);
}
