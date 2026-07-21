#!/usr/bin/env bash
# LARGE FORMAT — verify the carried patch set (LAR-625 two-track gate).
# Bash 3.2 safe (macOS default). Fails hard (exit 1) on any non-applying / drifted patch.
#
#   Track A (dependency patches, applied by `bun install`):
#     A1. Cold-cache `bun install --frozen-lockfile` MUST succeed. Bun hard-fails
#         only on a STRUCTURALLY invalid patchfile, so A1 alone is a weak drift
#         detector (LAR-625 finding: bun's applier is fuzzy on context mismatch,
#         and a warm patch cache can serve a stale patched tree). Hence A2.
#     A2. Post-install CONTENT assertions: each patched dependency file must
#         contain its expected sentinel string. This is what actually catches
#         "patch applied to the wrong place" / upstream drift.
#
#   Track B (own-source patches, applied by apply-patches.sh):
#     B1. apply-patches.sh resets a throwaway checkout to the pinned SHA and
#         applies patches/NNNN-*.patch in order, failing hard on the first that
#         does not apply cleanly, then writes a content-hash marker.
#
# Usage: verify-patches.sh
#   Run from the repo root (where .upstream-refs / patches / apply-patches.sh live).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
# shellcheck source=/dev/null
source "$HERE/.upstream-refs"

BUN="${BUN:-$HOME/.bun/bin/bun}"
FAIL=0
note() { printf '%s\n' "$*"; }

# ---- Track A: dependency patches via bun -------------------------------------
note "== Track A: bun install --frozen-lockfile (cold patch cache) =="
# Clear only the patched-package cache entries so a stale patched tree can't mask
# a broken patch. Add one glob per patched dependency.
rm -rf "$HOME"/.bun/install/cache/embedded-postgres@*patch_hash* 2>/dev/null || true
rm -rf "$HERE/node_modules"
if "$BUN" install --frozen-lockfile >/tmp/verify-patches-bun.log 2>&1; then
  note "A1 ok    bun install --frozen-lockfile succeeded"
else
  note "A1 FAIL  bun install --frozen-lockfile failed:"; sed 's/^/    /' /tmp/verify-patches-bun.log | tail -5; FAIL=1
fi

# A2. content assertions — "<sentinel>::<relative-glob-under-node_modules/.bun>"
# One entry per patched dependency. The sentinel MUST be text the patch INTRODUCES.
ASSERTIONS='const LC_MESSAGES_LOCALE = '"'"'C'"'"'::embedded-postgres@*/node_modules/embedded-postgres/dist/index.js'
while IFS= read -r line; do
  [ -n "$line" ] || continue
  sentinel="${line%%::*}"; glob="${line##*::}"
  found=0
  for f in "$HERE"/node_modules/.bun/$glob; do
    [ -f "$f" ] || continue
    if grep -qF "$sentinel" "$f"; then found=1; break; fi
  done
  if [ "$found" = 1 ]; then note "A2 ok    sentinel present: [$sentinel]"; else
    note "A2 FAIL  sentinel MISSING (patch drifted/misapplied): [$sentinel] in $glob"; FAIL=1; fi
done <<EOF
$ASSERTIONS
EOF

# ---- Track B: own-source patches via apply-patches.sh ------------------------
note ""
note "== Track B: apply-patches.sh on a throwaway checkout =="
TMPWT="$(mktemp -d "${TMPDIR:-/tmp}/verify-patches-wt.XXXXXX")"
cleanup() { git worktree remove --force "$TMPWT" >/dev/null 2>&1 || rm -rf "$TMPWT"; }
trap cleanup EXIT
git worktree add --quiet --detach "$TMPWT" "$UPSTREAM_PIN_SHA"
if "$HERE/apply-patches.sh" "$TMPWT" >/tmp/verify-patches-apply.log 2>&1; then
  note "B1 ok    apply-patches.sh applied cleanly; marker:"
  sed 's/^/    /' "$TMPWT/.patched-tree-marker" 2>/dev/null || true
else
  note "B1 FAIL  apply-patches.sh failed:"; sed 's/^/    /' /tmp/verify-patches-apply.log | tail -5; FAIL=1
fi

note ""
if [ "$FAIL" = 0 ]; then note "VERIFY-PATCHES: GREEN (all tracks passed)"; exit 0
else note "VERIFY-PATCHES: RED (see failures above)"; exit 1; fi
