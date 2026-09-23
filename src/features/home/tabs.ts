/**
 * /home's five faces and labels, in the root tree because the marketing landing demo
 * renders the selector too. The SPA's pane tokens stay in `pages/home/home-tabs.ts`.
 */

/**
 * Key `channels` ≠ label "Channel" on purpose: the face shows one channel, and renaming a
 * read key buys nothing. `identities` is the agent-identity face, not live agents.
 */
export type HomeTab =
  | "overview"
  | "channels"
  | "knowledge"
  | "identities"
  | "ontology";

/** Order is the data. The default lives apart in `home-tabs.ts`, so a re-order never moves it. */
export const HOME_TABS = [
  { key: "overview", label: "Overview" },
  { key: "channels", label: "Channel" },
  { key: "knowledge", label: "Knowledge" },
  { key: "identities", label: "Identities" },
  { key: "ontology", label: "Ontology" },
] as const satisfies ReadonlyArray<{ key: HomeTab; label: string }>;
