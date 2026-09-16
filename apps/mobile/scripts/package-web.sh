#!/usr/bin/env bash
#
# Packages the Expo web export into something a static host can serve from any
# path, for a browsable preview of the app.
#
# ⚠️ This is a PREVIEW, not a target. Habba ships to iOS and Android; §3 names
# Expo and React Native and nothing here changes that. What the preview is for
# is letting somebody click through the real screens, with the real copy and
# the real flows, without a build device — running against `InMemoryRepository`
# (ADR-0010), because no Supabase project exists to point at.
#
# `expo export --platform web` alone is not servable off a root path:
#
#   1. It writes its bundle under `_expo/`, and leading underscores are
#      reserved by some static hosts.
#   2. Every reference to the bundle, the lazy chunk and the fonts is absolute
#      (`/_expo/…`, `/assets/…`), so the whole thing 404s under a subdirectory.
#   3. Expo Router derives the initial route from `location.pathname`. Served
#      at `/somewhere/`, it reads that as a route, finds nothing, and renders
#      "Unmatched Route" — a blank-looking app with no error to explain it.
#
# Each is handled below. (3) is handled without knowing the path in advance:
# the page pins relative URLs to its own directory with a `<base>` element and
# then rewrites the address to `/`, so the router starts where it expects to.
#
# Usage: ./scripts/package-web.sh [output-dir]   (default: .web-publish)

set -euo pipefail

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPORT_DIR="$APP/.web-build"
OUT="${1:-$APP/.web-publish}"

echo "── exporting"
rm -rf "$EXPORT_DIR"
npx expo export --platform web --output-dir "$EXPORT_DIR" >/dev/null

echo "── repackaging into $(basename "$OUT")"
rm -rf "$OUT"
cp -r "$EXPORT_DIR" "$OUT"

# (1) `_expo` → `expo-static`.
mv "$OUT/_expo" "$OUT/expo-static"

# (2) Absolute → relative, in the HTML and inside the bundle. The bundle holds
#     the lazy chunk's path and every font and image URI; a `sed` is crude and
#     it is also exactly right, because these are literal strings the bundler
#     wrote and nothing computes them.
sed -i.bak 's|/_expo/static|expo-static/static|g; s|href="/favicon.ico"|href="favicon.ico"|' \
  "$OUT/index.html"
sed -i.bak 's|"/_expo/static/js/web/|"expo-static/static/js/web/|g; s|"/assets/|"assets/|g' \
  "$OUT"/expo-static/static/js/web/*.js
find "$OUT" -name '*.bak' -delete

# (3) The base-path shim, injected as the first thing in <head> so it runs
#     before the parser reaches the bundle's <script>.
#
#     ⚠️ Order matters twice. The `<base>` has to exist before the script tag
#     is parsed, or the relative `src` resolves against the rewritten address;
#     and the address has to be rewritten before the bundle EXECUTES, or the
#     router reads the hosting path as a route. Putting both in one head
#     script satisfies both.
python3 - "$OUT/index.html" <<'PY'
import sys

path = sys.argv[1]
html = open(path, encoding='utf-8').read()

shim = """<script>
      /* Served from a subdirectory? Pin relative URLs to it, then tell the
         router it is at the root. See scripts/package-web.sh. */
      (function () {
        try {
          var dir = location.pathname.replace(/[^/]*$/, '');
          if (dir === '/') return;
          var base = document.createElement('base');
          base.href = location.origin + dir;
          document.head.appendChild(base);
          history.replaceState(null, '', '/');
        } catch (error) {
          /* A sandboxed or opaque origin refuses both. The app still loads
             from wherever the browser resolved the bundle; only deep links
             are affected, and there are none on a first visit. */
        }
      })();
    </script>
    """

marker = '<meta charset="utf-8" />'
assert marker in html, 'expo export changed its HTML shape'
html = html.replace(marker, marker + '\n    ' + shim, 1)

# Arabic is the default locale (§2.1) and the shell should say so before any
# JavaScript runs, so the loading frame is not a left-to-right flash.
html = html.replace('<html lang="en">', '<html lang="ar">', 1)

open(path, 'w', encoding='utf-8').write(html)
print('   shim injected')
PY

echo "── done: $OUT ($(du -sh "$OUT" | cut -f1), $(find "$OUT" -type f | wc -l | tr -d ' ') files)"
