#!/usr/bin/env node
// LARGE FORMAT — repair native dylib version symlinks that `bun install` drops.
//
// WHY (LAR-625): Bun 1.3.14 does NOT preserve intra-tarball symlinks when it
// extracts a package into its store (verified: bun's global cache entry for
// @embedded-postgres/darwin-arm64 contains 0 symlinks; pnpm's contains 17).
// The shipped native libs use the standard versioned-SONAME layout:
//     libicudata.77.1.dylib            (real file)
//     libicudata.77.dylib  -> real     (symlink the loader actually resolves)
//     libicudata.dylib     -> real     (symlink)
// Binaries reference the MAJOR-only alias via @loader_path/../lib/libX.MAJOR.dylib.
// With the aliases missing, dyld fails ("Library not loaded: libicudata.77.dylib")
// and embedded Postgres `initdb` is killed -> the server cannot boot.
//
// This script recreates the missing version-alias symlinks for the native lib
// dirs shipped by @embedded-postgres/* under Bun's store. It is:
//   - a NO-OP on pnpm installs (only touches node_modules/.bun/**),
//   - idempotent (skips aliases that already exist),
//   - conservative (only creates aliases pointing at a real file that exists).
//
// Wired into the root `postinstall` so `bun install` self-heals. Remove once Bun
// preserves tarball symlinks (track upstream) or the installer decision changes.
import { existsSync, lstatSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";

const bunStore = join(process.cwd(), "node_modules", ".bun");
if (!existsSync(bunStore)) {
  // pnpm (or no install) — nothing to repair.
  process.exit(0);
}

/** Collect native/lib dirs shipped by @embedded-postgres/* store entries. */
function nativeLibDirs() {
  const dirs = [];
  for (const entry of readdirSync(bunStore)) {
    if (!entry.startsWith("@embedded-postgres+")) continue;
    const libDir = join(bunStore, entry, "node_modules", ...entry.split("+")[0].split("/"), "native", "lib");
    // entry looks like "@embedded-postgres+darwin-arm64@18.1.0-beta.16"
    const pkg = entry.replace(/@[^@]*$/, ""); // "@embedded-postgres+darwin-arm64"
    const resolved = join(bunStore, entry, "node_modules", pkg.replace("+", "/"), "native", "lib");
    if (existsSync(resolved)) dirs.push(resolved);
    else if (existsSync(libDir)) dirs.push(libDir);
  }
  return dirs;
}

let created = 0;
for (const libDir of nativeLibDirs()) {
  for (const file of readdirSync(libDir)) {
    const full = join(libDir, file);
    let st;
    try { st = lstatSync(full); } catch { continue; }
    if (!st.isFile()) continue; // skip existing symlinks / dirs
    // libNAME.MAJOR[.MINOR...].dylib -> aliases libNAME.MAJOR.dylib and libNAME.dylib
    const m = file.match(/^(lib.+?)\.(\d+)(?:\.[0-9.]+)?\.dylib$/);
    if (!m) continue;
    const [, base, major] = m;
    for (const alias of [`${base}.${major}.dylib`, `${base}.dylib`]) {
      if (alias === file) continue;
      const aliasPath = join(libDir, alias);
      if (existsSync(aliasPath) || safeIsLink(aliasPath)) continue;
      try { symlinkSync(file, aliasPath); created += 1; } catch { /* best effort */ }
    }
  }
}

function safeIsLink(p) {
  try { return lstatSync(p).isSymbolicLink(); } catch { return false; }
}

if (created > 0) console.log(`  ✓ Repaired ${created} native dylib symlink(s) dropped by bun install (LAR-625)`);
