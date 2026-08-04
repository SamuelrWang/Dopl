import "server-only";
import {
  LATEST_RELEASE_URL,
  RELEASE_CHANNEL_FILE,
  RELEASE_OWNER,
  RELEASE_REPO,
} from "./latest-release";

/**
 * WHERE THE LANDING PAGE'S "Download" BUTTON POINTS.
 *
 * WHY THIS IS NOT A CONSTANT. It was one, and it was broken:
 *
 *   https://github.com/SamuelrWang/Dopl/releases/latest/download/Dopl-arm64.dmg
 *
 * with a comment claiming "the version-less asset name keeps this link valid
 * across builds". electron-builder does not publish a version-less asset — its
 * default `artifactName` is `${productName}-${version}-${arch}.${ext}`, so the
 * newest release carries `Dopl-1.7.24-arm64.dmg` and that URL 404s, and has
 * 404'd for every release there has ever been. `/releases/latest/download/:asset`
 * is evergreen in the RELEASE, not in the ASSET NAME: GitHub resolves "latest"
 * for you and then demands the exact file name, which moves every release.
 *
 * So the asset name is READ rather than guessed, from the same file the rest of
 * this directory already reads — `latest-mac.yml`, electron-updater's channel
 * file, published beside the artifacts on every release. `latest-release.ts`
 * documents at length why that file and not `api.github.com` (rate limits on a
 * shared lambda egress IP; a tag can exist with no mac build behind it); every
 * word of it applies here. The name comes back CURRENT by construction, because
 * it was just read out of the release GitHub itself calls latest.
 *
 * THE ALTERNATIVE, AND WHY NOT. Pinning `artifactName` in the desktop's
 * electron-builder config to a version-less name would make the original
 * constant true — one line, no route. It was rejected for this pass: it renames
 * the artifacts in 1.8.3, which is the min-version gate's first release and the
 * one release whose auto-update path must not acquire a new variable; it leaves
 * the public button 404ing until that release actually ships, which is after
 * this branch merges; and it drops the version out of the downloaded file name,
 * which is the first thing a support conversation asks for. Nothing here
 * forecloses it — if the artifacts are ever renamed, this resolver keeps working
 * unchanged, because it never assumed a name in the first place.
 */

/** The human page every failure lands on. Always valid, whatever GitHub says. */
export const RELEASES_PAGE_URL = `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/latest`;

/** The channel file is a few hundred bytes; anything larger is not it. */
const MAX_FEED_CHARS = 8 * 1024;

/**
 * How long a resolved asset name is reused. A release is a manual, laptop-run
 * ritual, so ten minutes of staleness costs at most ten minutes of the previous
 * build being served — and the previous build auto-updates itself on first run.
 */
export const MAC_DOWNLOAD_TTL_S = 600;

/** Bounds a socket on the click path; the fallback is one line below it. */
const FETCH_TIMEOUT_MS = 4000;

/**
 * `- url: Dopl-1.7.24-arm64.dmg`, the channel file's `files:` block.
 *
 * The character class is the whole security story of this module. The captured
 * name is interpolated into a github.com URL, so it may not contain `/`, `:`,
 * `%`, `?`, `#`, `\` or whitespace — which forecloses path traversal, an
 * absolute URL smuggled in as an "asset name", and a query/fragment that would
 * re-point the link. It must also END in `.dmg`, so the zip, the blockmaps and
 * an HTML error page all fail to match rather than producing a plausible URL.
 * Anchored per line (`m`) and length-bounded, like `CHANNEL_VERSION_RE`.
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
 * The evergreen GitHub URL for an asset of the newest non-prerelease release.
 * `/releases/latest/download/:asset` is the pattern the old constant used and
 * the one it should have used — it is correct the moment the name is real.
 */
export function macDownloadUrlFor(asset: string): string {
  return (
    `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}` +
    `/releases/latest/download/${asset}`
  );
}

/**
 * The URL to send a clicking visitor to. NEVER throws and never returns
 * something that is not a github.com release URL: every failure — a timeout, a
 * 5xx, an HTML captive-portal page, a channel file with no dmg in it — degrades
 * to the releases page, which is a worse click but never a dead one.
 */
export async function resolveMacDownloadUrl(): Promise<string> {
  try {
    const res = await fetch(LATEST_RELEASE_URL, {
      // github.com 302s to the release-asset CDN — following it IS the request.
      redirect: "follow",
      headers: { accept: "text/yaml, text/plain, */*" },
      // One read per TTL for the whole deployment, not one per click.
      next: { revalidate: MAC_DOWNLOAD_TTL_S },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return note(`${LATEST_RELEASE_URL} answered ${res.status}`);
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_FEED_CHARS) {
      return note(`${RELEASE_CHANNEL_FILE} answered ${declared} bytes, which is not a channel file`);
    }
    const asset = parseChannelDmgAsset(await res.text());
    return asset
      ? macDownloadUrlFor(asset)
      : note(`${RELEASE_CHANNEL_FILE} named no .dmg asset`);
  } catch (err) {
    return note(`${RELEASE_CHANNEL_FILE} fetch failed: ${(err as Error)?.message ?? String(err)}`);
  }
}

/** Says it once, then shuts up — the `latest-release.ts` idiom. */
let lastNote: string | null = null;

function note(detail: string): string {
  if (detail !== lastNote) {
    lastNote = detail;
    console.warn(`[mac-download] ${detail} — the button falls back to the releases page.`);
  }
  return RELEASES_PAGE_URL;
}

/** Tests only: the dedupe above is module state. */
export function __resetMacDownloadForTests(): void {
  lastNote = null;
}
