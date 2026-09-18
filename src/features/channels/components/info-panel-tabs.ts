/**
 * Channels — THE INFO COLUMN'S TAB VOCABULARY: which options the row holds, what
 * each is called on the face it is showing, and what number rides beside it.
 *
 * ⚠ **SPLIT OUT OF `info-panel.tsx` ON 2026-09-16, WHEN THE ARTIFACTS FACE TOOK
 * THAT FILE OVER THE 500-LINE CAP** (`eslint.config.mjs › max-lines`). One file per
 * reason to change (INVARIANTS §1): this moves when the ROW does — a tab added,
 * renamed, gated or re-labelled — and the panel moves when its bodies or its
 * layout do. It is the same split `pages/home/home-tabs.ts` took off /home's page
 * for the same reason.
 *
 * ⚠ **`TabKey` AND `channelPaneTabs` ARE RE-EXPORTED BY `info-panel.tsx`**, so every
 * existing `from "./info-panel"` importer — the skeleton's tab-count reference, the
 * single-column header, the surface — is unchanged and there is still ONE path to
 * each symbol.
 *
 * ⚠ NO JSX AND NO STATE. Everything here is a value or a pure function, which is
 * what lets the row's rules be read (and tested) without mounting a panel.
 */

const TABS = [
  { key: "info", label: "Info" },
  { key: "threads", label: "Threads" },
  { key: "agents", label: "Agents" },
  { key: "settings", label: "Settings" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

/**
 * THE ROW IS SHORTER IN THREAD VIEW (Samuel, 2026-08-21).
 *
 * ⚠ THREADS IS A CHANNEL-VIEW TAB: with a thread open, a list of the channel's
 * OTHER threads is the one control here that navigates away from what the reader
 * is looking at. The sidebar's tree covers thread-to-thread movement meanwhile.
 *
 * ⚠ THREAD VIEW IS THE ONLY THING THAT SHORTENS THE ROW, AND THERE IS NO
 * CAPABILITY-GATED TAB LEFT (Samuel's ruling R-18, 2026-09-17): the `knowledge` arm
 * went with the hostless Knowledge lane, so every host draws the same four
 * options and `options.length > 4` can never be true again.
 */
export function channelPaneTabs(
  threadView: boolean
): ReadonlyArray<(typeof TABS)[number]> {
  return TABS.filter((t) => t.key !== "threads" || !threadView);
}

/**
 * THE TAB-ROW BADGES (2026-08-20), on `SegmentedControl`'s existing optional
 * `count`.
 *
 * ⚠ `undefined` IS THE "CANNOT SAY" ANSWER AND IT IS LOAD-BEARING: no badge is
 * drawn for it, which is what `agentSessions === null` needs — "could not ask"
 * must NOT render as a confident `0` (INVARIANTS §11, UNKNOWN is not EMPTY).
 *
 * ⚠ INFO AND SETTINGS GET NONE: Info already carries the mentions unread
 * count INSIDE it (`info-tab.tsx`), and two numbers leave the reader guessing.
 *
 * ⚠ THREADS COUNTS THE LOADED LIST — count what is displayed and say when the
 * display clipped (`threadsTruncated`), never a wider count nothing renders.
 */
export function tabCount(
  key: TabKey,
  threads: readonly unknown[],
  agentCount: number | undefined
): number | undefined {
  if (key === "threads") return threads.length;
  if (key === "agents") return agentCount;
  return undefined;
}

/**
 * 🔒 **THE THREADS SLOT'S HEADING IS THE FACE THAT IS ON** (Samuel, 2026-09-16:
 * *"heading 'Threads' becomes 'Artifacts'"*). One row option, two labels.
 *
 * ⚠ **AND THE BADGE GOES, RATHER THAN BEING REPURPOSED.** The number beside this
 * tab counts THREADS — the list the tab body is rendering — and in the artifacts
 * face that body is a different list this row has not read. Printing the thread
 * count under the word "Artifacts" would be a confident wrong number, and
 * `undefined` is this row's existing "cannot say" (see {@link tabCount}), which
 * draws no badge at all rather than a `0`.
 */
export function threadsFaceOption(
  option: (typeof TABS)[number],
  artifactsFace: boolean
): { key: TabKey; label: string; count?: number } {
  return artifactsFace && option.key === "threads"
    ? { key: option.key, label: "Artifacts" }
    : option;
}
