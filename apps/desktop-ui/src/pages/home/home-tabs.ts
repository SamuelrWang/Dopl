/** /home's tab vocabulary and the pane tokens it crossfades on. */

// The face set lives in the root tree (the landing demo renders the selector); re-exported here.
import { HOME_TABS, type HomeTab } from "@/features/home/tabs";

export { HOME_TABS, type HomeTab };

/** The face the page — and so Dopl — opens on. Deliberately not `HOME_TABS[0]`: the leftmost tab
 *  and the default are two decisions. */
export const HOME_DEFAULT_TAB: HomeTab = "overview";

/** No conversation selected; a token so the empty pane crossfades like any other. */
export const EMPTY_PANE = "empty";

/**
 * The prefixed faces' tokens, `<face>:<rowId>`. Row ids are `rel:`/`link:`-prefixed
 * (`home-rows.ts`), and no token prefix may be a prefix of another, so `HomePane`'s `startsWith`
 * branches never claim each other's tokens (INVARIANTS §4A). A new prefix must satisfy both.
 */
export const KNOWLEDGE_PANE = "knowledge:";
export const IDENTITIES_PANE = "identities:";

/** Whole tokens (compared with `===`): these faces are cross-channel and carry no row. */
export const OVERVIEW_PANE = "overview:";
export const ONTOLOGY_PANE = "ontology:";
