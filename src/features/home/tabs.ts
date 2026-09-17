/**
 * /home's TAB VOCABULARY — **the five faces and their labels, as DATA.**
 *
 * ⚠ **THE PANE TOKENS ARE NOT HERE.** `apps/desktop-ui/src/pages/home/home-tabs.ts`
 * keeps `HOME_DEFAULT_TAB`, `EMPTY_PANE` and the four crossfade tokens: those are
 * the SPA page's own machinery, they are read by `home-panes.tsx` alone, and the
 * disjointness rule they rely on is a rule about that page's row ids. What moved
 * on 2026-09-17 is the part a SECOND host renders — the header selector's
 * options — because the landing page's hero demo draws that strip
 * (`features/marketing/components/banner-demo/`) and the Next tree cannot import
 * `apps/` at all. `home-tabs.ts` re-exports both names, so every SPA import path
 * is unchanged and **nothing about the set, its order or its labels changed.**
 */

/**
 * The account surface's FIVE faces, all built.
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
 *
 * ⚠ AND ITS LABEL IS SINGULAR — **"Channel"** SINCE 2026-09-09 (Samuel). The
 * face shows ONE channel, the one the list beside it has selected, so the
 * plural named the list rather than the pane. ⚠ THE KEY DID **NOT** MOVE WITH
 * it this time: `"channels"` is read by `use-activity-jump.ts`, by the page's
 * `paneToken` fallback and by four suites, and a key rename buys nothing a
 * label rename already bought. Label ≠ key here, deliberately.
 */
export type HomeTab =
  | "overview"
  | "channels"
  | "knowledge"
  | "agents"
  | "ontology";

/**
 * ⚠ OVERVIEW IS FIRST **AND** IS THE DEFAULT (Samuel, 2026-09-01) — but the
 * DEFAULT is stated separately, in `pages/home/home-tabs.ts`, because deriving
 * one from the other is what makes a row re-order silently move where the app
 * lands.
 *
 * ⚠ **ORDER IS THE DATA** — the selector maps this array. ⚠ ONTOLOGY IS FIFTH
 * AND TO THE RIGHT OF AGENTS (Samuel, 2026-09-09).
 */
export const HOME_TABS = [
  { key: "overview", label: "Overview" },
  { key: "channels", label: "Channel" },
  { key: "knowledge", label: "Knowledge" },
  { key: "agents", label: "Agents" },
  { key: "ontology", label: "Ontology" },
] as const satisfies ReadonlyArray<{ key: HomeTab; label: string }>;
