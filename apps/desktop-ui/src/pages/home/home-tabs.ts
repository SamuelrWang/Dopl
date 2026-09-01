/**
 * /home's TAB VOCABULARY and the pane tokens it crossfades on.
 *
 * ⚠ **SPLIT OUT OF `index.tsx` ON 2026-09-01, WHEN THE FOURTH FACE LANDED AND
 * THE PAGE CROSSED THE 500-LINE CAP** (`eslint.config.mjs › max-lines`, an
 * error over `apps/*​/src/**`). One file per reason to change (INVARIANTS §1):
 * this changes when a FACE is added or renamed, the page when its layout or its
 * reads do. Nothing else moved — `paneToken` and `renderPane` stay in the page,
 * because they read that page's `selected` row.
 */

/**
 * The account surface's four faces, all built.
 *
 * ⚠ `"agents"` here is the TEMPLATE face — the channel info column has a
 * different tab of the same name listing live SESSIONS, and both names stay by
 * Samuel's ruling (INVARIANTS §5A).
 *
 * ⚠ `"channels"` WAS `"chat"` UNTIL 2026-09-01 (Samuel). It is LOCAL state with
 * no route and no persistence, so the key moved with the label and there was
 * nothing to migrate. ⚠ Do not read that rename as licence to rename the
 * `channels` PAGE segment (`routes.tsx › WORKSPACE_PAGES`), which is a real
 * path with a hand copy in `dopl-desktop-app/main/deep-link-target.js`.
 */
export type HomeTab = "overview" | "channels" | "knowledge" | "agents";

/**
 * ⚠ OVERVIEW IS FIRST **AND** IS NOW THE DEFAULT (Samuel, 2026-09-01). The two
 * were separate decisions for one day — leftmost but not the landing — and the
 * second one moved: opening Dopl should answer "what needs me / what is
 * happening / what is running" before it answers "what did we say". They are
 * still stated separately below, because deriving one from the other is what
 * makes a row re-order silently move where the app lands.
 */
export const HOME_TABS = [
  { key: "overview", label: "Overview" },
  { key: "channels", label: "Channels" },
  { key: "knowledge", label: "Knowledge" },
  { key: "agents", label: "Agents" },
] as const satisfies ReadonlyArray<{ key: HomeTab; label: string }>;

/**
 * The face the page opens on — **and therefore the page Dopl opens on**, since
 * /home is the desktop's landing surface.
 *
 * ⚠ NOT `HOME_TABS[0]` even though it currently names the same tab. The leftmost
 * tab and the default are two decisions; deriving one from the other would
 * silently change where the app lands the next time the row order is touched,
 * which is exactly the mistake this constant exists to prevent.
 *
 * ⚠ It was `"channels"` until 2026-09-01 (Samuel). LOCAL STATE ONLY — /home has
 * no per-face route and nothing is persisted, so there was no URL, no deep link
 * and no stored value to migrate; a deep link into a CHANNEL still lands on the
 * channels PAGE, which is a different surface entirely.
 */
export const HOME_DEFAULT_TAB: HomeTab = "overview";

/** No conversation selected. A token, so the empty pane crossfades like any
 *  other pane content — and it can never collide with a row id. */
export const EMPTY_PANE = "empty";

/**
 * The PREFIXED faces' tokens: `<face>:<rowId>`.
 *
 * 🔒 **SAFE BY CONSTRUCTION AND BY DISJOINTNESS, which is the rule INVARIANTS
 * §4A pins.** Row ids are `rel:`/`link:`-prefixed (`home-rows.ts`), so no
 * bare-row (Channels) token can wear either prefix and `slice` recovers the row
 * id exactly; and neither is a prefix OF the other, so the `startsWith` branches
 * in `index.tsx › renderPane` cannot claim each other's tokens. **A third prefix
 * must satisfy both halves.**
 */
export const KNOWLEDGE_PANE = "knowledge:";
export const AGENTS_PANE = "agents:";

/**
 * Overview's token — a WHOLE token, not a prefix (2026-09-01).
 *
 * ⚠ **IT CARRIES NO ROW BECAUSE THE FACE CARRIES NO CHANNEL.** Knowledge and
 * Agents render a selected channel's contents and must re-key when the selection
 * moves; Overview is cross-channel, so keying it by the row would remount and
 * refetch the whole analytics face on every click of the list beside it. It is
 * compared with `===`, not `startsWith`.
 * ⚠ It still cannot collide with anything: row ids are `rel:`/`link:`-prefixed,
 * and it is neither of the two prefixes above nor a prefix of them.
 */
export const OVERVIEW_PANE = "overview:";
