#!/usr/bin/env bash
#
# THE SUPPORTED WAY TO SHIP A DESKTOP RELEASE. One command, loud at every step.
#
# ── Why this exists (F-193) ──────────────────────────────────────────────────
#
# Two releases, two DIFFERENT silent partial uploads, and no error either time:
#
#   1.10.0 — electron-builder uploaded the zip, both blockmaps and latest-mac.yml
#            but NOT the DMG, and left the release in DRAFT (its default).
#   1.10.1 — the inverse: the DMG and both blockmaps landed, the zip and
#            latest-mac.yml did not. `releases/latest/download/latest-mac.yml`
#            404'd, which is what every auto-updater reads. Fail-safe, so nobody
#            would ever have noticed: updaters simply saw nothing new.
#
# Both were repaired by hand with the same two commands. `electron-builder
# --publish always` reports success in both cases, so THE POST-UPLOAD ASSERTION
# IS THE ENTIRE POINT OF THIS SCRIPT — steps 5 and 7 re-read what GitHub actually
# has and refuse to call it a release until the five names are there and the
# public feed URL serves the same bytes as dist/.
#
# And one structural wrinkle it also fixes: the afterSign hook notarizes and
# staples the .app, THEN latest-mac.yml is generated, and only THEN is the DMG
# stapled — which changes the DMG's bytes. So the feed's DMG sha512/size have
# always described pre-staple bytes. Harmless to the updater (it installs from
# the zip) but the feed lied about the DMG on both releases. Step 4 re-hashes.
#
# ── Usage ────────────────────────────────────────────────────────────────────
#
#   npm run release                       # the real thing
#   npm run release -- --dry-run          # build + staple + re-hash, publish NOTHING
#   npm run release -- --skip-build       # resume from an existing dist/ (repair path)
#   npm run release -- --dry-run --skip-build
#
# --dry-run    stops after step 4. Nothing is uploaded and nothing on GitHub is
#              touched or read destructively. Preflight checks that only protect
#              a real publish (clean tree, release-must-not-exist, credentials)
#              degrade to warnings, because none of them can be violated by a run
#              that publishes nothing.
# --skip-build skips step 1's renderer build and step 2 entirely and works from
#              whatever is already in dist/. BOTH real repairs needed exactly
#              this — the artifacts were fine, the publish was not.
#
# No secret is ever echoed: credentials are probed for PRESENCE only.
#
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/.." && pwd)"
DIST="$APP_DIR/dist"
YML="$DIST/latest-mac.yml"

DRY_RUN=0
SKIP_BUILD=0
STEP="startup"

# ── Output discipline ────────────────────────────────────────────────────────
# Every failure names the STEP it happened in and the remedy, because the whole
# class of bug this script exists for is "it looked like it worked".
step() { STEP="$1"; printf '\n=== %s ===\n' "$1"; }
ok()   { printf '  \xe2\x80\xa2 %s\n' "$1"; }
warn() { printf '  ! %s\n' "$1" >&2; }
die()  { printf '\nFAILED at: %s\n  %s\n' "$STEP" "$1" >&2; exit 1; }
# A check that is fatal for a real publish and advisory for a dry run.
soft() { if (( DRY_RUN )); then warn "$1 (dry-run: not fatal)"; else die "$1"; fi; }

while (( $# > 0 )); do
  case "$1" in
    --dry-run)    DRY_RUN=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help)    sed -n '2,45p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *)            die "unknown flag '$1' — expected --dry-run, --skip-build or --help." ;;
  esac
  shift
done

# ── Artifact discovery ───────────────────────────────────────────────────────
# electron-builder's filenames carry an arch suffix that depends on the build
# host ("-arm64", "-x64", "-universal", or nothing at all for a plain x64
# build). Rather than guess, probe the four legal shapes and require EXACTLY
# ONE to exist. A glob would be wrong for a different reason: `Dopl-1.10.1*.dmg`
# also matches 1.10.11.
find_artifact() {
  local template="$1" suffix cand
  local found=()
  for suffix in "" "-arm64" "-x64" "-universal"; do
    cand="$DIST/${template/@/$suffix}"
    if [[ -f "$cand" ]]; then found+=("$cand"); fi
  done
  if (( ${#found[@]} == 0 )); then
    die "no artifact matching '${template/@/<arch>}' in dist/ — run without --skip-build, or check the version in package.json."
  fi
  if (( ${#found[@]} > 1 )); then
    die "${#found[@]} artifacts match '${template/@/<arch>}' in dist/: ${found[*]} — clean dist/ and rebuild."
  fi
  printf '%s\n' "${found[0]}"
}

# ═════════════════════════════════════════════════════════════════════════════
# 1. PREFLIGHT
# ═════════════════════════════════════════════════════════════════════════════
step "1/8 preflight"

[[ "$(uname -s)" == "Darwin" ]] || die "this is a macOS release (signing, notarization, stapler); run it on the Mac."

VERSION="$(node -p "require('$APP_DIR/package.json').version")"
OWNER="$(node -p "require('$APP_DIR/package.json').build.publish[0].owner")"
REPO="$(node -p "require('$APP_DIR/package.json').build.publish[0].repo")"
TAG="v$VERSION"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] \
  || die "package.json version '$VERSION' is not a semver — electron-updater matches the tag v<version> exactly."
ok "version $VERSION  ->  tag $TAG  ->  $OWNER/$REPO"

# -- git tree clean --------------------------------------------------------
# A published build must correspond to a commit; otherwise the tag points at
# source nobody can reproduce.
if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
  soft "working tree is dirty — commit or stash before publishing (git -C '$REPO_ROOT' status)."
else
  ok "git tree clean"
fi

# -- the tag must not already be a published release -----------------------
# INVERTED FOR --dry-run: a dry run publishes nothing, so an existing release is
# merely information. And a DRAFT is allowed even for a real run, because a draft
# IS the 1.10.0 failure mode — electron-builder's own leftover — and refusing it
# would block the repair path --skip-build exists for.
RELEASE_STATE="absent"
if IS_DRAFT="$(gh release view "$TAG" --json isDraft --jq .isDraft 2>/dev/null)"; then
  if [[ "$IS_DRAFT" == "true" ]]; then RELEASE_STATE="draft"; else RELEASE_STATE="published"; fi
fi
case "$RELEASE_STATE" in
  absent)    ok "no release $TAG yet (gh release view 404s)" ;;
  draft)     ok "release $TAG exists as a DRAFT — resuming into it (this is the 1.10.0 failure shape)" ;;
  published)
    if (( DRY_RUN )); then
      warn "release $TAG is already PUBLISHED (dry-run: not fatal, nothing will be touched)"
    else
      die "release $TAG is already PUBLISHED — bump the version in dopl-desktop-app/package.json, or delete the release if it was a mistake (gh release delete $TAG)."
    fi
    ;;
esac

# -- web deploy live-check: the ship-order gate ----------------------------
# Web ships BEFORE desktop. This endpoint answering 200 is the observable proof
# the web deploy is live; a desktop build published against a stale server is
# the thing the order exists to prevent.
#
# NOTE the apex 307-redirects to www, so this must use www (or -L) — a curl
# without either reports 307 and proves nothing.
#
# DO NOT be tempted to assert `latest == $VERSION` here. `latest` is DERIVED FROM
# THE GITHUB RELEASE FEED (src/shared/version/latest-release.ts), not from the
# web deploy, so before this release exists it necessarily reads as the previous
# version. The assertion would be circular and would fail every real release.
VERSION_JSON="$(mktemp)"
trap 'rm -f "$VERSION_JSON"' EXIT
HTTP_CODE="$(curl -sL --max-time 20 -o "$VERSION_JSON" -w '%{http_code}' https://www.usedopl.com/api/version || echo "000")"
[[ "$HTTP_CODE" == "200" ]] \
  || die "https://www.usedopl.com/api/version answered $HTTP_CODE, not 200 — the web deploy is not live. Ship web first (the ship-order gate), then re-run."
ok "web deploy live: /api/version 200 -> $(tr -d '\n' < "$VERSION_JSON")"

# -- signing identity ------------------------------------------------------
security find-identity -v -p codesigning 2>/dev/null | grep -q "Developer ID Application" \
  || die "no 'Developer ID Application' identity in the keychain — electron-builder cannot sign. Install the Developer ID cert (see ENGINEERING §18)."
ok "signing identity present: Developer ID Application (7352NBAF44)"

# -- notary auth (PRESENCE ONLY — nothing is printed) ----------------------
if [[ -n "${DOPL_NOTARY_PROFILE:-}" ]]; then
  ok "notary auth: keychain profile (\$DOPL_NOTARY_PROFILE set)"
elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]]; then
  ok "notary auth: Apple ID env vars (password loaded, not shown)"
else
  soft "no notary credentials — set DOPL_NOTARY_PROFILE, or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD, or run 'bash scripts/finish-notarize.sh setup' once."
fi

# -- GitHub token (PRESENCE ONLY) ------------------------------------------
if [[ -n "${GH_TOKEN:-}" ]]; then
  ok "GitHub auth: \$GH_TOKEN set"
elif gh auth token >/dev/null 2>&1; then
  # ⚠ EXPORTED, NOT JUST DETECTED (2026-09-01). This branch used to only REPORT
  # that the gh CLI was logged in, and the 1.25.0 release failed here because of
  # it: electron-builder reads the GH_TOKEN ENV VAR and cannot see the CLI's
  # keyring, so the preflight said "GitHub auth: ok", the build ran for six
  # minutes, notarization succeeded — and then all four uploads died with
  # "GitHub Personal Access Token is not set". A preflight that passes on
  # credentials the publisher cannot use is worse than one that fails, because
  # it fails AFTER the expensive part. Detecting it and handing it over is the
  # whole fix. The value is never printed and never reaches a command line.
  GH_TOKEN="$(gh auth token)"
  export GH_TOKEN
  ok "GitHub auth: gh CLI logged in (token exported for electron-builder)"
else
  soft "no GitHub credentials — run 'gh auth login' or export GH_TOKEN. electron-builder and every upload step need it."
fi

# -- renderer freshness ----------------------------------------------------
# renderer/app is the build output of apps/desktop-ui and is gitignored; a
# release built over a stale one ships last week's UI inside this week's app.
if (( SKIP_BUILD )); then
  [[ -f "$APP_DIR/renderer/app/index.html" ]] \
    || die "--skip-build was given but renderer/app/index.html is missing — there is nothing to resume from. Re-run without --skip-build."
  ok "renderer/app present (not rebuilt: --skip-build)"
else
  ok "building renderer (npm run build:ui at repo root)…"
  ( cd "$REPO_ROOT" && npm run build:ui )
  [[ -f "$APP_DIR/renderer/app/index.html" ]] \
    || die "npm run build:ui finished but renderer/app/index.html is absent — check apps/desktop-ui's build output path."
  ok "renderer built fresh"
fi

# ═════════════════════════════════════════════════════════════════════════════
# 2. BUILD + PUBLISH
# ═════════════════════════════════════════════════════════════════════════════
step "2/8 build"
if (( SKIP_BUILD )); then
  ok "skipped (--skip-build) — resuming from $DIST"
elif (( DRY_RUN )); then
  ok "electron-builder --mac --publish never (dry-run)"
  ( cd "$APP_DIR" && npx electron-builder --mac --publish never )
else
  # --publish always is what uploads; the afterSign hook (scripts/notarize.js)
  # notarizes and staples the .app inside this step. Do not add a second .app
  # notarization anywhere — this one is it.
  ok "electron-builder --mac --publish always"
  ( cd "$APP_DIR" && npx electron-builder --mac --publish always )
fi

ZIP="$(find_artifact "Dopl-$VERSION@-mac.zip")" || exit 1
DMG="$(find_artifact "Dopl-$VERSION@.dmg")" || exit 1
ZIP_MAP="$ZIP.blockmap"
DMG_MAP="$DMG.blockmap"
[[ -f "$ZIP_MAP" ]] || die "missing $(basename "$ZIP_MAP") — electron-builder emits it beside the zip; rebuild."
[[ -f "$DMG_MAP" ]] || die "missing $(basename "$DMG_MAP") — electron-builder emits it beside the dmg; rebuild."
[[ -f "$YML"     ]] || die "missing dist/latest-mac.yml — this is the auto-updater feed; rebuild."
ok "artifacts: $(basename "$ZIP"), $(basename "$DMG"), both blockmaps, latest-mac.yml"

# ═════════════════════════════════════════════════════════════════════════════
# 3. STAPLE THE DMG
# ═════════════════════════════════════════════════════════════════════════════
# Reuses scripts/finish-notarize.sh rather than reimplementing notarytool — one
# credential ladder, one place. That script targets the NEWEST .dmg in dist/ by
# mtime, so assert it would pick OURS before handing over; dist/ accumulates
# every past build and a --skip-build resume can easily make that untrue.
step "3/8 staple the DMG"
if xcrun stapler validate "$DMG" >/dev/null 2>&1; then
  ok "already stapled (ticket validates) — nothing to do"
else
  NEWEST_DMG="$(find "$DIST" -maxdepth 1 -name '*.dmg' -exec stat -f '%m %N' {} + | sort -rn | head -1 | cut -d' ' -f2-)"
  [[ "$NEWEST_DMG" == "$DMG" ]] \
    || die "finish-notarize.sh staples the newest .dmg in dist/, which is $(basename "$NEWEST_DMG"), not $(basename "$DMG"). Clean the older builds out of dist/ and re-run."
  ok "notarizing + stapling via scripts/finish-notarize.sh (Apple takes 5-15 min)…"
  bash "$APP_DIR/scripts/finish-notarize.sh"
  xcrun stapler validate "$DMG" >/dev/null 2>&1 \
    || die "stapler validate still fails after finish-notarize.sh — do not publish; read that script's output above."
  ok "stapled and validated"
fi

# ═════════════════════════════════════════════════════════════════════════════
# 4. RE-HASH THE FEED'S DMG ENTRY
# ═════════════════════════════════════════════════════════════════════════════
# Stapling rewrote the DMG, so latest-mac.yml's DMG sha512/size are stale by
# construction. The zip entry and the top-level path/sha512 (the zip's, and the
# one the updater installs from) must not move — the patcher rewrites two lines
# and copies everything else, and test/release-yml.test.mjs pins that.
step "4/8 re-hash latest-mac.yml (DMG entry only)"
node "$APP_DIR/scripts/release-yml.js" patch-dmg "$YML" "$DMG"
grep -q "^version: $VERSION\$" "$YML" \
  || die "dist/latest-mac.yml does not declare version $VERSION — the feed is from a different build. Clean dist/ and rebuild."
ok "feed declares version $VERSION"

if (( DRY_RUN )); then
  step "DRY RUN COMPLETE"
  ok "stopped after step 4. Nothing uploaded; no GitHub state touched."
  ok "zip : $(basename "$ZIP")"
  ok "dmg : $(basename "$DMG")  (stapled)"
  ok "feed: $YML"
  printf '\n--- dist/latest-mac.yml ---\n'
  cat "$YML"
  printf '\nRun without --dry-run to publish %s.\n' "$TAG"
  exit 0
fi

# ═════════════════════════════════════════════════════════════════════════════
# 5. UPLOAD ALL FIVE, THEN ASSERT ALL FIVE
# ═════════════════════════════════════════════════════════════════════════════
# --clobber makes this idempotent and makes it a repair tool: whatever
# electron-builder did or did not manage, after this the five are the five.
step "5/8 upload all five assets + assert"
if [[ "$RELEASE_STATE" == "absent" ]]; then
  # electron-builder normally creates the release during --publish. If it did
  # not (or --skip-build meant it never ran), create it so upload has a target.
  gh release view "$TAG" >/dev/null 2>&1 \
    || gh release create "$TAG" --draft --title "$TAG" --notes "Dopl $VERSION"
fi
gh release upload "$TAG" --clobber "$ZIP" "$ZIP_MAP" "$DMG" "$DMG_MAP" "$YML" \
  || die "gh release upload failed — see the error above; re-run with --skip-build once it is addressed."
ok "uploaded 5 assets"

# THE ASSERTION THIS SCRIPT EXISTS FOR. Re-read the release from GitHub and
# refuse to continue unless all five names are present AND finished uploading.
# Written to a file rather than piped so a `gh` failure and an assertion failure
# cannot be confused for one another.
ASSETS_JSON="$(mktemp)"
trap 'rm -f "$VERSION_JSON" "$ASSETS_JSON"' EXIT
gh release view "$TAG" --json assets > "$ASSETS_JSON" \
  || die "could not re-read release $TAG from GitHub, so the upload is UNVERIFIED. Do not announce it; re-run with --skip-build."
node "$APP_DIR/scripts/release-yml.js" assert-assets "$ASSETS_JSON" \
    "$(basename "$ZIP")" "$(basename "$ZIP_MAP")" \
    "$(basename "$DMG")" "$(basename "$DMG_MAP")" "latest-mac.yml" \
  || die "the release is missing assets AFTER a successful-looking upload — this is exactly the 1.10.0/1.10.1 failure. Re-run with --skip-build."

# ═════════════════════════════════════════════════════════════════════════════
# 6. UNDRAFT + MARK LATEST
# ═════════════════════════════════════════════════════════════════════════════
# electron-builder leaves the release in DRAFT by default, and a draft is
# invisible to releases/latest/download — the URL every auto-updater reads.
step "6/8 undraft + mark latest"
gh release edit "$TAG" --draft=false --latest \
  || die "gh release edit failed — the assets are up but the release is still a draft, so the updater feed is dark. Re-run with --skip-build."
ok "release $TAG is published and marked latest"

# ═════════════════════════════════════════════════════════════════════════════
# 7. VERIFY THE PUBLIC FEED
# ═════════════════════════════════════════════════════════════════════════════
# The one check that speaks for the auto-updater instead of for us: fetch the
# exact URL electron-updater fetches and require it to be byte-identical to the
# file we just built. 1.10.1 shipped with this URL 404ing.
step "7/8 verify the public feed"
FEED_URL="https://github.com/$OWNER/$REPO/releases/latest/download/latest-mac.yml"
FETCHED="$(mktemp)"
trap 'rm -f "$VERSION_JSON" "$ASSETS_JSON" "$FETCHED"' EXIT
FEED_OK=0
for attempt in 1 2 3 4 5 6; do
  if curl -fsSL --max-time 20 -o "$FETCHED" "$FEED_URL"; then FEED_OK=1; break; fi
  warn "feed not served yet (attempt $attempt/6) — GitHub takes a moment after undrafting; retrying in 5s"
  sleep 5
done
(( FEED_OK )) || die "$FEED_URL never served — the release is published but the updater feed is unreachable. Check the asset name is exactly 'latest-mac.yml'."
diff -u "$YML" "$FETCHED" \
  || die "the public feed DIFFERS from dist/latest-mac.yml (diff above) — an older copy is being served. Re-upload with --skip-build."
grep -q "^version: $VERSION\$" "$FETCHED" \
  || die "the public feed does not declare version $VERSION — updaters will not offer this build."
ok "public feed is byte-identical to dist/latest-mac.yml and declares $VERSION"

# ═════════════════════════════════════════════════════════════════════════════
# 8. FINAL VERIFICATION BLOCK
# ═════════════════════════════════════════════════════════════════════════════
step "8/8 verification"
printf '  release      : %s  (%s/%s)\n' "$TAG" "$OWNER" "$REPO"
printf '  package.json : %s\n' "$VERSION"
printf '  feed version : %s\n' "$(grep '^version:' "$YML" | cut -d' ' -f2-)"
if xcrun stapler validate "$DMG" >/dev/null 2>&1; then
  printf '  staple       : DMG ticket validates\n'
else
  printf '  staple       : NOT STAPLED\n'
fi
printf '  assets on GitHub:\n'
gh release view "$TAG" --json assets \
  --jq '.assets[] | "    \(.name)  \(.size) bytes  \(.state)"'
printf '  feed URL     : %s  (fetched, identical)\n' "$FEED_URL"
printf '\nDone. %s is live.\n' "$TAG"
