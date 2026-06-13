#!/usr/bin/env bash
#
# One-command notarization of the already-built, already-signed DMG.
# Use this when Apple credentials weren't available at build time.
#
# Required env:
#   APPLE_ID                      your Apple ID email
#   APPLE_APP_SPECIFIC_PASSWORD   app-specific password (appleid.apple.com)
#
# Usage:
#   export APPLE_ID="you@apple.id"
#   export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
#   npm run notarize
#
set -euo pipefail

TEAM_ID="7352NBAF44"
DIST_DIR="$(cd "$(dirname "$0")/.." && pwd)/dist"

# Credentials: prefer env vars; otherwise read from the local signing-credentials
# file (never printed). Override the path with DOPL_SIGNING_CREDS_FILE.
CREDS_FILE="${DOPL_SIGNING_CREDS_FILE:-$HOME/Desktop/openclaw/workspace/memory/apple-signing-checklist.md}"

if [[ -z "${APPLE_ID:-}" || -z "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]]; then
  if [[ -f "$CREDS_FILE" ]]; then
    # Parse the markdown table rows "| Apple ID | ... |" and "| App-specific password | ... |"
    APPLE_ID="${APPLE_ID:-$(grep -iE '\| *Apple ID *\|' "$CREDS_FILE" | head -1 | awk -F'|' '{gsub(/ /,"",$3); print $3}')}"
    APPLE_APP_SPECIFIC_PASSWORD="${APPLE_APP_SPECIFIC_PASSWORD:-$(grep -iE '\| *App-specific password *\|' "$CREDS_FILE" | head -1 | awk -F'|' '{gsub(/ /,"",$3); print $3}')}"
  fi
fi

if [[ -z "${APPLE_ID:-}" || -z "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]]; then
  echo "ERROR: no creds. Set APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD, or provide $CREDS_FILE." >&2
  exit 1
fi

echo "• Using Apple ID: ${APPLE_ID}  (password loaded, not shown)"

DMG="$(ls -t "$DIST_DIR"/*.dmg 2>/dev/null | head -1 || true)"
if [[ -z "$DMG" ]]; then
  echo "ERROR: no .dmg found in $DIST_DIR — run 'npm run build' first." >&2
  exit 1
fi

echo "• Notarizing: $DMG"
echo "  (Apple usually takes 5–15 min)"
xcrun notarytool submit "$DMG" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$TEAM_ID" \
  --wait

echo "• Stapling ticket to DMG…"
xcrun stapler staple "$DMG"

echo "• Validating…"
xcrun stapler validate "$DMG"
spctl -a -t open --context context:primary-signature -vv "$DMG" || true

echo "• Done ✓  Notarized DMG ready: $DMG"
