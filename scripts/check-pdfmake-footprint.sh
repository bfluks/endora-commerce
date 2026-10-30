#!/usr/bin/env bash
# Constitution IV / Infrastructure Constraints — pdfmake footprint gate.
#
# pdfmake is the comparisons module's PDF engine (feature 007). It ships
# with bundled Roboto fonts which set a hard floor around ~14 MB, but
# any future major bump that pulls in additional fonts or native deps
# would push the single-VPS minimum spec up. This script fails the build
# if the on-disk size grows beyond MAX_BYTES — the threshold has
# headroom over today's measured size and can be bumped explicitly when
# the team accepts the new floor.
#
# Run from the repo root:
#   bash scripts/check-pdfmake-footprint.sh

set -eu

# Resolve the repo root so the script works regardless of cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=scripts/lib/read-size.sh
source "$SCRIPT_DIR/lib/read-size.sh"

# 32 MB headroom over the ~14.6 MB measured at install time. The number
# is intentionally generous: this gate is a tripwire against accidents,
# not a tight budget.
MAX_BYTES=$((32 * 1024 * 1024))

# The precondition below used to `exit 0` with a "skipping" line. A gate that
# reports success when it measured nothing is indistinguishable from one that
# measured and approved — the whole of issue #113 — so an unmeasurable run exits
# 2: not clean (0), not over budget (1), but "this said nothing". A measurement
# that is not a number exits 2 for the same reason.

# pnpm hoists pdfmake into .pnpm/pdfmake@<version>/node_modules/pdfmake.
# Fall back to a top-level node_modules path if the user has run a
# non-pnpm install.
candidates=(
  node_modules/.pnpm/pdfmake@*/node_modules/pdfmake
  node_modules/pdfmake
)
target=""
for c in "${candidates[@]}"; do
  if [ -d "$c" ]; then
    target="$c"
    break
  fi
done
if [ -z "$target" ]; then
  echo "[pdfmake-gate] pdfmake is not installed — nothing was measured; run pnpm install first." >&2
  exit 2
fi

# What was read, beside what was found (issue #244). `du` on a directory that
# exists but holds almost nothing — a half-written pnpm store entry, a package
# whose files were pruned — reports a small size, which this gate reads as
# "under budget" and reports as a pass. The file count is what tells the two
# apart. `self-reported`: nothing in the tree derives how many files a
# dependency ships.
# `tr -d ' '` because BSD `wc` pads its count, and the read line is parsed.
read_size_report '[pdfmake-gate]' "$(find "$target" -type f | wc -l | tr -d ' ')" - self-reported

# The bytes of every file, summed by `wc -c` over their concatenation. It used
# to be `du -sb`, which BSD `du` does not have (issue #315): on macOS the
# pipeline answered an empty string, the comparison below errored inside its
# own `if`, and the gate printed "OK — 0.0 MB". Plain `find`, `cat` and `wc`
# mean the same thing on every userland, and anything that is still not a
# number is refused rather than compared.
actual=$(find "$target" -type f -exec cat {} + | wc -c | tr -d ' ')
case "$actual" in
  '' | *[!0-9]*)
    echo "[pdfmake-gate] could not measure $target (got '$actual') — refusing to report a vacuous pass." >&2
    exit 2
    ;;
esac
if [ "$actual" -gt "$MAX_BYTES" ]; then
  human_actual=$(awk -v b="$actual" 'BEGIN{printf "%.1f MB", b/1048576}')
  human_max=$(awk -v b="$MAX_BYTES" 'BEGIN{printf "%.1f MB", b/1048576}')
  echo "[pdfmake-gate] FAIL — pdfmake on-disk size is $human_actual (max $human_max)." >&2
  echo "[pdfmake-gate]   path: $target" >&2
  echo "[pdfmake-gate]   bump MAX_BYTES in this script if the new floor is intentional." >&2
  exit 1
fi

human_actual=$(awk -v b="$actual" 'BEGIN{printf "%.1f MB", b/1048576}')
human_max=$(awk -v b="$MAX_BYTES" 'BEGIN{printf "%.1f MB", b/1048576}')
echo "[pdfmake-gate] OK — pdfmake on-disk size $human_actual (max $human_max)."
