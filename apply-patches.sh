#!/usr/bin/env bash
# LARGE FORMAT — apply the carried patch set onto a PRISTINE upstream checkout at the pin.
# Adopted per LAR-621 (Jake Krogman's pin+patch-carry discipline; NO containers).
#
# Usage: apply-patches.sh <checkout-dir>
#   <checkout-dir> is reset to pristine at UPSTREAM_PIN_SHA, then patches/NNNN-*.patch
#   are applied in order. Fails hard on the first patch that does not apply cleanly.
#
# Discipline enforced here:
#   1. Resolve + verify the pin BY SHA (never trust a tag string; the pin carries >1 tag).
#   2. Reset to pristine at the pin so patches apply forward from clean.
#   3. Apply numbered patches in order; fail hard on first failure.
#   4. git apply for indexed targets; patch(1) for any gitignored/unindexed target
#      (git apply silently no-ops on unindexed paths — exit 0, no change).
#   5. Content-hash the patched targets into .patched-tree-marker (silent-no-op guard).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKOUT="${1:?usage: apply-patches.sh <checkout-dir>}"
# shellcheck source=/dev/null
source "$HERE/.upstream-refs"
cd "$CHECKOUT"

# 1. resolve + verify pin by SHA
git fetch --quiet "$UPSTREAM_REMOTE" || true
RESOLVED="$(git rev-parse --verify "${UPSTREAM_PIN_SHA}^{commit}")"
[ "$RESOLVED" = "$UPSTREAM_PIN_SHA" ] || { echo "FATAL: pin did not resolve to itself ($RESOLVED != $UPSTREAM_PIN_SHA)" >&2; exit 1; }

# 2. reset to pristine at the pin
git checkout --quiet --detach "$UPSTREAM_PIN_SHA"
git reset --quiet --hard "$UPSTREAM_PIN_SHA"
git clean -qfdx -e node_modules -e .upstream-refs -e patches -e apply-patches.sh

# 3. apply numbered patches, fail hard on first failure
shopt -s nullglob
PATCHES=( "$HERE"/patches/[0-9][0-9][0-9][0-9]-*.patch )
[ ${#PATCHES[@]} -gt 0 ] || { echo "FATAL: no patches found in $HERE/patches" >&2; exit 1; }
for p in "${PATCHES[@]}"; do
  name="$(basename "$p")"
  if git apply --check "$p" 2>/dev/null; then
    git apply "$p"; echo "ok  (git apply)  $name"
  elif patch -p1 --dry-run --silent < "$p" >/dev/null 2>&1; then
    patch -p1 --silent < "$p"; echo "ok  (patch -p1)  $name  [unindexed]"
  else
    echo "FAIL  $name — does not apply cleanly to pin $UPSTREAM_PIN_SHA" >&2; exit 1
  fi
done

# 4. content-hash marker (silent-no-op guard) — bash 3.2 compatible (macOS default; no mapfile)
TOUCHED=()
while IFS= read -r f; do [ -n "$f" ] && TOUCHED+=("$f"); done < <(
  for p in "${PATCHES[@]}"; do git apply --numstat "$p" 2>/dev/null | awk '{print $3}'; done | sort -u
)
MARK="$(for f in "${TOUCHED[@]}"; do [ -f "$f" ] && git hash-object "$f"; done | git hash-object --stdin)"
printf '%s  %s\n' "$MARK" "$UPSTREAM_PIN_SHA" > "$CHECKOUT/.patched-tree-marker"
echo "ALL PATCHES APPLIED CLEANLY. marker=$MARK  pin=$UPSTREAM_PIN_SHA"
