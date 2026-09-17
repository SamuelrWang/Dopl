import { Link2 } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
import type { BootPayload } from "#/pages/boot/use-boot-state";
import { RelationshipRecord } from "./relationship-record";
import { PendingLinkCard } from "./link-out-panel";
import { HomeKnowledgePanels } from "./knowledge-panels";
import { HomeAgentPanels } from "./agent-panels";
import { HomeOntologyPanels } from "./ontology-panels";
import { HomeOverviewPanels } from "./overview-panels";
import type { ActivityJump } from "./use-activity-jump";
import type { HomeRow } from "./home-rows";
import {
  AGENTS_PANE,
  EMPTY_PANE,
  KNOWLEDGE_PANE,
  ONTOLOGY_PANE,
  OVERVIEW_PANE,
  type HomeTab,
} from "./home-tabs";

/**
 * /home's PANE — which token the crossfade is on, and what that token renders.
 *
 * ⚠ **SPLIT OUT OF `index.tsx` ON 2026-09-09, WHEN THE FIFTH FACE LANDED**, for
 * the reason `home-tabs.ts` and `home-header.tsx` were split out before it: the
 * page sits against the 500-line cap (`eslint.config.mjs › max-lines`, an error
 * over `apps/*​/src/**`) and could not hold a fifth branch. One file per reason
 * to change (INVARIANTS §1): this changes when a FACE renders something else,
 * the page when its layout or its reads do.
 *
 * ⚠ NOTHING MOVED BUT THE CLOSURE. `renderPane` read the page's `selected` row
 * and `visible` list off scope; both are parameters now, and every rule the two
 * functions carried came with them verbatim.
 */

/**
 * 🔒 EVERY FACE THAT RENDERS A CHANNEL IS KEYED BY THE ROW, NOT BY THE TAB
 * (2026-08-26). Channels always was; Knowledge and then Agents had to become so
 * the moment they started rendering a CHANNEL's contents. The two CROSS-channel
 * faces — Overview, and Ontology since 2026-09-09 — carry no row at all, which
 * is the same rule read the other way: a face is keyed by what it VARIES with.
 * Keyed by the bare tab name, switching channels leaves the token frozen
 * at `"knowledge"` / `"agents"` — the crossfade never fires and the pane swaps
 * one channel's bases (or templates) for another's UNDER a token that says
 * nothing changed, which is the 150ms wrong-channel flash.
 */
export function paneToken(tab: HomeTab, selectedId: string | null): string {
  if (tab === "knowledge") return `${KNOWLEDGE_PANE}${selectedId ?? EMPTY_PANE}`;
  if (tab === "agents") return `${AGENTS_PANE}${selectedId ?? EMPTY_PANE}`;
  // ⚠ ONTOLOGY CARRIES NO ROW EITHER, and for the same reason Overview does
  // not: its rows are the operator's PERSONAL ontologies, so the face does not
  // vary with the selection and re-keying it would close an open board on every
  // click of the list beside it (`home-tabs.ts › ONTOLOGY_PANE`).
  if (tab === "ontology") return ONTOLOGY_PANE;
  // 🔒 THE OVERVIEW TOKEN CARRIES NO ROW (2026-09-01). Every other face renders
  // a CHANNEL's contents and so must re-key on the selection; this one is
  // cross-channel, so keying it by `selected` would remount and refetch the
  // whole analytics face every time the operator clicked a different row in the
  // list beside it — a crossfade with nothing to fade to.
  if (tab === "overview") return OVERVIEW_PANE;
  return selectedId ?? EMPTY_PANE;
}

export interface HomePaneProps {
  /** The token currently ON SCREEN — which lags the selection by one fade. */
  shown: string;
  /** Every row the operator has. ⚠ **ONE LIST SINCE 2026-09-17** — the page's
   *  narrowed `visible` twin went with the search filter (`index.tsx`). */
  rows: HomeRow[];
  identity: BootPayload;
  jump: ActivityJump;
  /** The selected channel was deleted — the page drops the selection and
   *  refetches. */
  onChannelDeleted: () => void;
}

/**
 * What the pane shows for one token.
 *
 * ⚠ PURE IN `shown`, because the crossfade renders the PREVIOUS token for a
 * beat after the selection moves — reading the page's `selected` here instead
 * would swap the content before the fade.
 *
 * ⚠ FIXED BRANCH ORDER, PREFIXED FACES FIRST. The prefixes are disjoint and
 * none can be a row id (`home-tabs.ts` carries the rule), so no token is
 * claimed twice; the order is fixed anyway so that adding a face is a one-line
 * insertion above the bare-row fallback rather than a re-reading of which
 * branch wins.
 */
export function HomePane({
  shown,
  rows,
  identity,
  jump,
  onChannelDeleted,
}: HomePaneProps) {
  /** The row a pane token names, or `null`. ⚠ READ OUT OF THE TOKEN, never out
   *  of the page's `selected` — that is what makes the pane pure in `shown` and
   *  lets the outgoing channel's panels finish their fade against their own
   *  data. */
  const rowFor = (id: string) =>
    rows.find((candidate) => candidate.id === id) ?? null;

  if (shown === OVERVIEW_PANE) {
    // ⚠ NO ROW IS READ OUT OF THIS TOKEN and there is none in it — the face is
    // cross-channel (see `paneToken` above and `home/server/service-overview.ts`,
    // which carries why the channel-scoped half was deleted).
    // ⚠ `homeWorkspaceId` is the SAME boot query the other faces read, and it is
    // the caller's own `kind='personal'` CONTAINER (`workspaces/server/
    // segment.ts › getBootState` answers `ensurePersonalContainer`). That is what
    // makes the credit bar the reader's PERSONAL WALLET: a status read addressed
    // at a personal container resolves to that wallet
    // (`billing/server/credits-service.ts › resolveBillingTarget`), never to a
    // workspace seat. ⚠ The standard-workspace reroute this comment used to name
    // was deleted 2026-09-07. NULL until the caller is onboarded.
    return (
      <HomeOverviewPanels
        homeWorkspaceId={identity.workspace?.id ?? null}
        onOpenActivity={jump.open}
      />
    );
  }
  if (shown === ONTOLOGY_PANE) {
    // ⚠ NO ROW IS READ OUT OF THIS TOKEN and there is none in it. An ontology
    // is a PERSONAL item of the home space (Samuel, 2026-09-09), lent into
    // channels by reference — so this face is cross-channel exactly as Overview
    // is, and it takes the PERSONAL container rather than the selected
    // channel's link container.
    return (
      <HomeOntologyPanels
        homeWorkspaceId={identity.workspace?.id ?? null}
        homeWorkspaceSegment={identity.segment}
      />
    );
  }
  if (shown.startsWith(AGENTS_PANE)) {
    const shownRow = rowFor(shown.slice(AGENTS_PANE.length));
    return (
      <HomeAgentPanels
        // 🔒 KEYED BY THE TOKEN — one token, one instance, and it was NOT so
        // until 2026-08-26 (F-338). `Crossfade` renders `{children(shownToken)}`
        // with no key of its own and every `agents:<rowId>` token returns this
        // element at the SAME position, so React reconciled ONE instance across
        // a channel switch and the panel's held state (`scope`, `editing`,
        // `copying`) survived while `channel.workspaceId` moved underneath it.
        // That is not a stale render: the editor and the copy dialog take the
        // target workspace as a PROP, so a create composed against the old row
        // POSTed into the NEW container and SUCCEEDED — no 404, no rollback,
        // the wrong relationship's container. ⚠ AND THE SWITCH NEED NOT BE A
        // CLICK: `selected` falls back to `visible[0]` whenever the selected
        // row leaves `visible` (a roster change, an archive, the peer-joins
        // teardown), so the held row can move with nobody touching the list.
        // ⚠ THE KEY IS THE TOKEN, NOT THE ROW: keying a face by the same value
        // its parent swaps on is the whole statement — one token, one
        // instance — and it stays true for a face keyed by more than a row id.
        key={shown}
        channel={shownRow?.kind === "channel" ? shownRow.channel : null}
        // ⚠ SAME BOOT QUERY AS KNOWLEDGE'S SCOPE C — the home workspace is
        // `POST /api/boot`'s no-segment answer, so the second template list
        // costs no extra identity read. NULL until the caller is onboarded.
        // ⚠ The SEGMENT rides it too and the home-workspace editor needs it
        // (its teams read is keyed by the segment, not the id); boot's `role`
        // does NOT go to this face — nothing on it is role-gated.
        homeWorkspaceId={identity.workspace?.id ?? null}
        homeWorkspaceSegment={identity.segment}
        currentUserId={identity.userId}
      />
    );
  }
  if (shown.startsWith(KNOWLEDGE_PANE)) {
    const shownRow = rowFor(shown.slice(KNOWLEDGE_PANE.length));
    return (
      <HomeKnowledgePanels
        // 🔒 KEYED BY THE ROW, exactly as the chat branch below is, and it was
        // NOT until 2026-08-26. `paneToken` fixes the CROSSFADE; it does not
        // remount, so React reconciled channel B's panels onto channel A's
        // component instance and the pane's own `useState` survived the switch.
        // `openBase` is the sharp one: a base opened in channel A stayed open
        // across the switch and was then mounted against channel B's
        // `workspaceId`, i.e. a 404 error pane over a base that exists. `scope`
        // survived too, which is merely wrong rather than broken.
        // ⚠ `knowledge-tab.tsx` had already solved this on the CHANNEL side;
        // this is the same fix on the /home side. A pane holding per-channel
        // state owes itself a key — the token is about the animation.
        key={shownRow?.id ?? EMPTY_PANE}
        channel={shownRow?.kind === "channel" ? shownRow.channel : null}
        // ⚠ ALREADY IN THIS PAGE'S BOOT QUERY — the home workspace is
        // `POST /api/boot`'s no-segment answer, so scope C costs no second
        // identity read. NULL until the caller is onboarded; the panel says so
        // rather than fetching a workspace that does not exist.
        homeWorkspaceId={identity.workspace?.id ?? null}
        homeWorkspaceSegment={identity.segment}
        homeRole={identity.role}
        currentUserId={identity.userId}
      />
    );
  }
  const row = rowFor(shown);
  if (row === null) {
    // 🔒 **ONE SENTENCE SINCE 2026-09-17.** There were two — "No matches" over
    // the SEARCH narrowing, and "No channels yet" over an empty account — and
    // the first is DELETED with the narrowing itself (Samuel's popup ruling;
    // `index.tsx` carries it). A token with no row now means either that there
    // are no channels, or that the selected one was deleted and the crossfade
    // is still showing its token: the first is a fact worth a line, the second
    // resolves within the fade and must not claim the account is empty.
    return rows.length === 0 ? (
      <EmptyState
        icon={Link2}
        title="No channels yet"
        description="Create one and launch an agent into it."
      />
    ) : null;
  }
  if (row.kind === "link") return <PendingLinkCard key={row.id} link={row.link} />;
  return (
    <RelationshipRecord
      key={row.id}
      homeChannel={row.channel}
      currentUserId={identity.userId}
      // ⚠ KEYED BY THE ROW, so a thread picked in channel A can never be raised
      // inside channel B — see `use-activity-jump.ts`.
      initialThreadId={jump.threadFor(row.id)}
      onDeleted={onChannelDeleted}
    />
  );
}
