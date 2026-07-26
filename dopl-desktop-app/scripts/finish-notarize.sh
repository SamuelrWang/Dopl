#!/usr/bin/env bash
#
# One-command notarization + stapling of the already-built, already-signed DMG.
# Use this when Apple credentials weren't available at build time.
#
# ── Two credential modes (env vars are the primary path) ────────────────────
#
# 1. Environment variables (primary):
#      export APPLE_ID="you@apple.id"
#      export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # appleid.apple.com
#      npm run notarize
#
# 2. notarytool keychain profile (no secrets in the shell / env):
#      # one-time — stores the app-specific password in the login keychain:
#      bash scripts/finish-notarize.sh setup
#      # thereafter:
#      npm run notarize
#
#    Override the profile name with DOPL_NOTARY_PROFILE (default "dopl-notary").
#
# There is intentionally NO plaintext-file credential fallback.
#
set -euo pipefail

TEAM_ID="7352NBAF44"
PROFILE="${DOPL_NOTARY_PROFILE:-dopl-notary}"
DIST_DIR="$(cd "$(dirname "$0")/.." && pwd)/dist"

# ── `setup` subcommand: store an app-specific password in a keychain profile ──
# Runs notarytool's own interactive prompt — the password is written to the
# login keychain, never to disk in plaintext and never echoed here.
if [[ "${1:-}" == "setup" ]]; then
  echo "• Storing notarytool keychain profile: ${PROFILE}"
  echo "  You'll be prompted for your Apple ID and an app-specific password."
  xcrun notarytool store-credentials "$PROFILE" --team-id "$TEAM_ID"
  echo "• Saved. Future runs of 'npm run notarize' will use this profile."
  exit 0
fi

# ── Locate the newest DMG ────────────────────────────────────────────────────
DMG="$(ls -t "$DIST_DIR"/*.dmg 2>/dev/null | head -1 || true)"
if [[ -z "$DMG" ]]; then
  echo "ERROR: no .dmg found in $DIST_DIR — run 'npm run build' first." >&2
  exit 1
fi

# ── Choose credential mode: env vars first, else keychain profile ────────────
NOTARY_ARGS=()
if [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]]; then
  echo "• Auth: Apple ID env vars (password loaded, not shown)"
  NOTARY_ARGS=(--apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$TEAM_ID")
elif xcrun notarytool history --keychain-profile "$PROFILE" >/dev/null 2>&1; then
  echo "• Auth: notarytool keychain profile '${PROFILE}'"
  NOTARY_ARGS=(--keychain-profile "$PROFILE")
else
  echo "ERROR: no credentials." >&2
  echo "  Set APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD, or run:" >&2
  echo "    bash scripts/finish-notarize.sh setup" >&2
  exit 1
fi

echo "• Notarizing: $DMG"
echo "  (Apple usually takes 5-15 min)"
xcrun notarytool submit "$DMG" "${NOTARY_ARGS[@]}" --wait

echo "• Stapling ticket to DMG..."
xcrun stapler staple "$DMG"

echo "• Validating..."
xcrun stapler validate "$DMG"
spctl -a -t open --context context:primary-signature -vv "$DMG" || true

echo "• Done. Notarized DMG ready: $DMG"
