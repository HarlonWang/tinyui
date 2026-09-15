#!/usr/bin/env sh
# Builds the mqjs CLI used by run.py from mquickjs-kmp's upstream copy into bench/.engine (gitignored).
# Applies engine.patch (sub-millisecond performance.now) on the copy; the source tree is never touched.
set -e
SRC="${MQUICKJS_KMP_DIR:-$HOME/KMPProjects/mquickjs-kmp}/native/mquickjs"
DST="$(cd "$(dirname "$0")" && pwd)/.engine"
[ -f "$SRC/mqjs.c" ] || { echo "mquickjs sources not found at $SRC (set MQUICKJS_KMP_DIR)"; exit 1; }
rm -rf "$DST" && mkdir -p "$DST" && cp -R "$SRC"/. "$DST"/
cd "$DST" && patch -p1 < ../engine.patch && make mqjs >/dev/null
echo "built $DST/mqjs"
