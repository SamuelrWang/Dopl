import "server-only";
import {
  LATEST_RELEASE_URL,
  RELEASE_CHANNEL_FILE,
  RELEASE_OWNER,
  RELEASE_REPO,
  parseChannelVersion,
} from "./latest-release";

/**
 * Where the landing page's "Download" button points.
 * ⚠ THE ASSET NAME IS READ, NEVER GUESSED: `/releases/latest/download/:asset` is
 * evergreen in the RELEASE, not the ASSET NAME, and electron-builder stamps the
 * version in — so any hardcoded name 404s on every release. Read from
 * `latest-mac.yml`, the channel file `latest-release.ts` also reads.
 */

/** The human page every failure lands on. Always valid, whatever GitHub says. */
export const RELEASES_PAGE_URL = `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/latest`;

/** The channel file is a few hundred bytes; anything larger is not it. */
const MAX_FEED_CHARS = 8 * 1024;

/** How long a resolved release (asset name + tag, ONE read) is reused. Staleness
 *  costs an old build, not a dead button — only because the URL is tag-pinned
 *  alongside the name (F-131). */
export const MAC_DOWNLOAD_TTL_S = 600;

/** Bounds a socket on the click path; the fallback is one line below it. */
const FETCH_TIMEOUT_MS = 4000;

/**
 * `- url: Dopl-1.7.24-arm64.dmg`, from the channel file's `files:` block.
 *
 * ⚠ The character class is this module's security story: the captured name is
 * interpolated into a github.com URL, so it may not contain `/`, `:`, `%`, `?`,
 * `#`, `\` or whitespace — forecloses path traversal, a smuggled absolute URL,
 * and a query/fragment that would re-point the link. Must END in `.dmg` so the
 * zip, blockmaps and HTML error pages fail to match. Anchored per line (`m`) and
 * length-bounded.
 */
const CHANNEL_DMG_RE =
  /^[ \t]*-?[ \t]*url:[ \t]*["']?([A-Za-z0-9][A-Za-z0-9._-]{0,120}\.dmg)["']?[ \t\r]*$/m;

/** The asset name in the channel file's `files:` block, or null. Pure. */
export function parseChannelDmgAsset(body: string | null | undefined): string | null {
  if (typeof body !== "string" || body === "") return null;
  const m = CHANNEL_DMG_RE.exec(body.slice(0, MAX_FEED_CHARS));
  return m ? m[1] : null;
}

/**
 * GitHub URL for an asset of the release the channel file described.
 *
 * ⚠ TAG-PINNED, NOT `latest` (F-131). `/releases/latest/download/:asset` lets
 * GitHub resolve "latest" at CLICK time while the asset name was read up to a
 * TTL earlier — a name paired with the wrong release is a 404, not a stale
 * build. Releases are tagged `v${version}`, so name and release come from ONE
 * read. Missing version falls back to the `latest` form (never worse).
 *
 * `version` arrives via `parseChannelVersion`/`narrowVersion`, bounded to
 * `[0-9A-Za-z.-]` — URL-path-safe for the same reasons as `CHANNEL_DMG_RE`.
 */
export function macDownloadUrlFor(asset: string, version: string | null = null): string {
  const release = version ? `download/v${version}` : `latest/download`;
  return (
    `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}` +
    `/releases/${release}/${asset}`
  );
}

/**
 * NAME of the dmg the newest release publishes; `/get-started` names it in
 * install copy. ⚠ Read from the same `latest-mac.yml` as the URL, same request,
 * same TTL — never typed into copy, never from `package.json` (which says what
 * SHOULD ship, not what DID). `null` is first-class: the page drops to
 * version-less copy rather than guessing.
 */
export async function resolveMacDownloadAsset(): Promise<string | null> {
  return (await readChannel()).asset;
}

/** ⚠ ONE read yields asset name AND version — a name and tag from the same bytes
 *  cannot describe different releases (F-131). Fetch is deduped by Next's data
 *  cache (same URL + `revalidate`), so both resolvers cost one request per TTL. */
async function readChannel(): Promise<{ asset: string | null; version: string | null }> {
  const none = { asset: null, version: null };
  try {
    const res = await fetch(LATEST_RELEASE_URL, {
      // github.com 302s to the release-asset CDN — following it IS the request.
      redirect: "follow",
      headers: { accept: "text/yaml, text/plain, */*" },
      // One read per TTL for the deployment, not one per click.
      next: { revalidate: MAC_DOWNLOAD_TTL_S },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      note(`${LATEST_RELEASE_URL} answered ${res.status}`);
      return none;
    }
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_FEED_CHARS) {
      note(`${RELEASE_CHANNEL_FILE} answered ${declared} bytes, which is not a channel file`);
      return none;
    }
    const body = await res.text();
    const asset = parseChannelDmgAsset(body);
    if (!asset) {
      note(`${RELEASE_CHANNEL_FILE} named no .dmg asset`);
      return none;
    }
    return { asset, version: parseChannelVersion(body) };
  } catch (err) {
    note(`${RELEASE_CHANNEL_FILE} fetch failed: ${(err as Error)?.message ?? String(err)}`);
    return none;
  }
}

/**
 * URL to send a clicking visitor to. ⚠ NEVER throws, never returns anything but
 * a github.com release URL: every failure degrades to the releases page. Unlike
 * the asset-name resolver, this may NOT return null — a Download button with
 * nowhere to go is the bug this module exists to end.
 */
export async function resolveMacDownloadUrl(): Promise<string> {
  const { asset, version } = await readChannel();
  return asset ? macDownloadUrlFor(asset, version) : RELEASES_PAGE_URL;
}

/** Warn once per distinct message — the `latest-release.ts` idiom. */
let lastNote: string | null = null;

function note(detail: string): null {
  if (detail !== lastNote) {
    lastNote = detail;
    console.warn(`[mac-download] ${detail} — the button falls back to the releases page.`);
  }
  return null;
}

/** Tests only: the dedupe above is module state. */
export function __resetMacDownloadForTests(): void {
  lastNote = null;
}
