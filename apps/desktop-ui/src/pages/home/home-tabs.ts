/**
 * /home's TAB VOCABULARY and the pane tokens it crossfades on.
 *
 * ⚠ **SPLIT OUT OF `index.tsx` ON 2026-09-01, WHEN THE FOURTH FACE LANDED AND
 * THE PAGE CROSSED THE 500-LINE CAP** (`eslint.config.mjs › max-lines`, an
 * error over `apps/*​/src/**`). One file per reason to change (INVARIANTS §1):
 * this changes when a FACE is added or renamed, the page when its layout or its
 * reads do.
 *
 * ⚠ `paneToken` AND `renderPane` LEFT THE PAGE ON 2026-09-09, one file further
 * out — `home-panes.tsx`, which carries why. They stayed in `index.tsx` while
 * there were four faces because they read that page's `selected` row; the FIFTH
 * face is what made the page too long to hold them (the 500-line cap again),
 * and the row is a parameter rather than a closure now.
 */

/**
 * ⚠ **THE FACE SET AND ITS LABELS MOVED TO THE ROOT TREE ON 2026-09-17 AND ARE
 * RE-EXPORTED HERE** (`src/features/home/tabs.ts`), because the landing page's
 * hero demo renders the header selector and cannot import `apps/`. **The pane
 * tokens below did NOT move** — they are this page's own crossfade machinery.
 * Every SPA import path is unchanged.
 */
import { HOME_TABS, type HomeTab } from "@/features/home/tabs";

export { HOME_TABS, type HomeTab };

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
 * in `home-panes.tsx › HomePane` cannot claim each other's tokens. **A third
 * prefix must satisfy both halves.**
 */
export const KNOWLEDGE_PANE = "knowledge:";
export const IDENTITIES_PANE = "identities:";

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

/**
 * Ontology's token — a WHOLE token, for the SAME reason Overview's is
 * (2026-09-09).
 *
 * ⚠ **IT CARRIES NO ROW BECAUSE AN ONTOLOGY IS NOT THE CHANNEL'S.** Samuel's
 * ruling makes an ontology a PERSONAL item of the home space, lent into channels
 * by reference; the face therefore lists the same rows whichever channel the
 * list beside it has selected, and keying it by the selection would remount the
 * face — closing an open board — every time the operator clicked a row.
 * ⚠ It cannot collide with anything: row ids are `rel:`/`link:`-prefixed, and
 * `ontology:` is neither of the two prefixes above nor a prefix of them (nor of
 * `overview:`, nor it of this).
 */
export const ONTOLOGY_PANE = "ontology:";
