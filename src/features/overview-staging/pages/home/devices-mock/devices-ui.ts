// STAGING COPY of apps/desktop-ui/src/pages/home/devices-mock/devices-ui.ts @ branch devices-dashboard-mock. Only import paths differ from the source
// (desktop `#/` modules → staging copies, data hooks → ./stubs). See src/features/overview-staging/PORTING.md.
/**
 * THE DEVICES SECTION'S FACES — one declaration per role, read by import, never retyped.
 *
 * ── ROUND 4c (2026-10-22) ────────────────────────────────────────────────────────────────────
 * Samuel rejected round 4b on two counts and both land here:
 *
 * 1. *"Devices Online, Agent's Running: … there are only a few lines of text on the left. The
 *    entire 80% of the right side is just blank white space."* The 26px `text-stat` figure in a
 *    300px card was the cause, so **`DEV_STAT` IS DELETED.** A figure is 14px mono now and lives
 *    in a header row beside other figures, where it is dense instead of marooned.
 * 2. *"what the agent did was just do a bunch of pills … which is not helpful whatsoever."*
 *    The chip is RARE now (`./devices-bits.tsx › Chip`). Its old jobs went to typography, a
 *    status dot, an icon mark, or a meter.
 *
 * ⚠ THE ONE LITERAL is the card's white fill, in `ui-staging/staging.css › .uis-dev-card`.
 */
import type { MockStatus } from "@/features/overview-staging/overview-mock-data";

/**
 * THE SECTION'S ONE REMAINING CARD — the Add-device chooser, and nothing else.
 *
 * ⚠ **ROUND 4d TOOK THE CARDS OFF EVERYTHING ELSE.** Samuel: *"the bento is not the right route.
 * I think having so many boxes just makes it look really busy and weird."* A box is kept only
 * where the boundary means something, and a transient panel laid over the page is the one place
 * on this section where it does.
 */
export const DEV_CARD = "uis-dev-card flex flex-col";

/* -------------------------------- clocks --------------------------------- */

/**
 * "12m ago" / "3h 4m" from MINUTES, and a justified hand-roll.
 *
 * ⚠ **THE PRODUCT COMPONENT IS `shared/lib/format-time.ts › formatRelativeTime`, AND IT IS THE
 * PORT TARGET.** It is not used here for one reason: it takes an ISO string and reads
 * `Date.now()`, and this section is server-rendered with a FIXED staged clock
 * (`ui-staging/staging-stubs.ts`), so the server's label and the client's can differ and React
 * throws a hydration mismatch. These two are pure functions of a constant. When the section reads
 * real devices, drop both and call `formatRelativeTime` client-side.
 */
export function ago(minutes: number): string {
  if (minutes <= 0) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export function duration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/* ------------------------------ id → device ------------------------------ */

/**
 * What every id-only surface needs to draw a device — the fallback chain, a routing row's
 * `tried`, a log row's `deviceId`.
 *
 * ⚠ IT CARRIES STATUS AND KIND, not just the name. The chain could not say WHY a question fell
 * through to the next device, because a name was all the old `Map<string, string>` held.
 * ⚠ IT LIVES HERE, not beside the card that builds it: the reach card and the activity card both
 * draw it, so putting it in either one makes the two import each other.
 */
export interface DeviceRef {
  name: string;
  kind: string;
  status: MockStatus;
}

const REMOVED: DeviceRef = { name: "Removed device", kind: "other", status: "offline" };

/** Resolve an id the way every caller must: a removed device still draws, named and offline. */
export function deviceRef(devices: Map<string, DeviceRef>, id: string): DeviceRef {
  return devices.get(id) ?? REMOVED;
}

/**
 * Dot fill per status. ⚠ THE SECTION'S ONLY COLOUR, and it is a 6px dot — `DESIGN-LANGUAGE.md`
 * §5 ("Green only for live/online, amber only for needs-you"). Everything else is greyscale.
 */
export const STATUS_DOT: Record<MockStatus, string> = {
  active: "bg-success",
  away: "bg-caution",
  offline: "bg-text-disabled",
};

export const STATUS_LABEL: Record<MockStatus, string> = {
  active: "Online",
  away: "Away",
  offline: "Offline",
};

/* ------------------------------ runtime marks ----------------------------- */

/**
 * RUNTIME LOGOS, so an agent row says what it runs on with a 14px MARK instead of a pill.
 *
 * ⚠ **STAGING-ONLY, AND IT IS THE SAME MAP THE IDENTITY CARDS USE** —
 * `identities-staging/data.ts › RUNTIME_LOGOS`, copied rather than imported because that file is
 * another worker's and carries its own in-flight edits. In the product this comes off the runtime
 * registry beside `RuntimeDescriptor.label`, which carries no logo yet (PORTING.md).
 * ⚠ A runtime with no logo falls back to its NAME in small muted type, never to a generic glyph:
 * a wrong mark is worse than no mark.
 */
const RUNTIME_LOGOS: Record<string, string> = {
  claude: "/img/onboarding/claude-logo.svg",
  codex: "/img/onboarding/chatgpt-logo.svg",
};

export function runtimeLogo(runtime: string): string | undefined {
  return RUNTIME_LOGOS[runtime.trim().toLowerCase()];
}

/* -------------------------------- type faces ------------------------------- */

/**
 * ── FOUR TYPE FACES, AND THERE ARE ONLY FOUR ────────────────────────────────────────────────
 * 4b cut six to five; 4c cuts five to four by deleting the 26px figure outright. The identity
 * card's own note is the rule being followed here: *"the type ladder, three steps and no more …
 * It was 11.5 here too, which is why the card read as one flat block of small grey text."*
 *
 *   `DEV_LABEL`  11px uppercase  — a label or a figure's unit. The only uppercase in the section.
 *   `DEV_NAME`   14px            — a card's name (`IDENTITY_NAME_TEXT`, by import)
 *   `DEV_ROW`    12.5px          — a row's one line of content
 *   `DEV_MONO`   10.5px mono     — every clock and duration
 *   `DEV_FIGURE` 14px mono       — a header figure (the replacement for `DEV_STAT`)
 *   `DEV_PROSE`  11.5px          — prose a human wrote, and nothing else
 */

/** A LABEL, or a figure's unit. The only uppercase in the section. */
export const DEV_LABEL = "text-label font-semibold uppercase tracking-wide text-text-muted";

/**
 * A HEADER FIGURE. ⚠ 14px, not 26px: the big figure is what left *"80% of the right side … blank
 * white space"*, because a 26px number needs a card and a card that size needs content it did not
 * have. Three of these sit in one header row instead.
 */
export const DEV_FIGURE = "text-title font-mono font-medium tabular-nums text-text-primary";

/** Every clock and duration — one mono face, so a column of them aligns. */
export const DEV_MONO = "font-mono text-micro tabular-nums text-text-muted";

/** A ROW'S ONE LINE of content. */
export const DEV_ROW = "text-body text-text-primary";

/**
 * The 11.5px quiet line. ⚠ **PROSE A HUMAN WROTE, AND NOTHING ELSE** — the preview warning, a
 * device's model name, a group's empty state. A FACT wears a dot, a mark, a meter or (rarely) a
 * chip; it never wears this. That rule is what 4b bought and 4c keeps.
 */
export const DEV_PROSE = "text-caption text-text-muted";

/** The Devices section's small text button (Rename, Reset, Save). */
export const SMALL_BTN =
  "cursor-pointer rounded-full px-2 py-0.5 text-caption text-text-secondary hover:bg-surface-raised-1 hover:text-text-primary";
