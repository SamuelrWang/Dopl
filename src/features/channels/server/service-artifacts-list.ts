import "server-only";
import type { ChannelFoldedArtifact } from "../types";
import { CHANNEL_ARTIFACT_LIST_LIMIT } from "../constants";
import { mapArtifactRow } from "./dto";
import * as repoArtifacts from "./repository-artifacts";
import { loadVisibleChannel, type ChannelContext } from "./service-shared";

/**
 * ARTIFACTS — THE BROWSE READ. One function, and its own file.
 *
 * ⚠ **IT IS NOT IN `service-artifacts.ts` BECAUSE THAT FILE IS AT THE §1 CAP**
 * (500 lines; it holds the four write actions, their authority, their idempotency
 * and the fold). The seam is real rather than arithmetic: those change when the
 * `op="artifact"` CONTRACT changes, and this changes when the Artifacts VIEW does
 * — it exists because Samuel asked for a panel that lists a room's cards, and it
 * is the only artifact read with no counterpart on the MCP surface.
 *
 * ⚠ **THE ARROWS STAY ONE-WAY.** It imports the shared gate and the repository and
 * nothing else in this directory — in particular NOT `service-artifacts.ts`, which
 * does not import this one either. Two leaves off `service-shared.ts`, no cycle to
 * reintroduce.
 */

/**
 * LIST THIS CHANNEL'S ARTIFACTS — the browse read behind the Artifacts face of
 * the /home threads panel.
 *
 * 🔒 **DESIGN §5 SAID A LIST WAS "NOT OFFERED"; SAMUEL'S 2026-09-16 ARTIFACTS-VIEW
 * RULING SUPERSEDES THAT, AND THE OLD REASON STAYS BESIDE THE NEW ONE RATHER THAN
 * BEING DELETED.** The design's argument was that "an artifact is found by reading
 * the transcript it folds", so a browse surface was a shape nothing asked for. What
 * changed is the second half only: the feature now asks for it — *"list shows this
 * channel's artifacts (named cards, openable)"* — and a panel cannot be built on a
 * transcript page, which holds only the cards the loaded window happened to fold.
 * ⚠ **NOTHING ABOUT THE GATE MOVED WITH IT.** This is `loadVisibleChannel`, the same
 * visibility-not-membership rule `service-artifacts.ts › readArtifact` takes: a reader
 * who can already read the room's transcript learns nothing here they could not have
 * scrolled to.
 *
 * ⚠ **THE SHAPE IS `ChannelFoldedArtifact`, NOT A NEW ONE**, so the card the face
 * draws and the card the transcript draws carry the same count and the same span —
 * from the same aggregate (`repository-artifacts.ts › artifactSpans`), which is
 * channel-wide by that type's contract. A second shape here is how the two surfaces
 * come to print different numbers for one artifact.
 *
 * ⚠ **AN ARTIFACT WITH NO MEMBERS IS OMITTED, AND IT IS A JUDGMENT CALL I AM NAMING.**
 * A create whose seqs all failed to match folds nothing (`ArtifactWriteResult.folded`
 * says so at the time), leaving a row that stands in for no messages: it has no count
 * and no span, and the only honest alternatives were to print `0 messages · #0–#0` —
 * seqs that do not exist — or to widen the shared type for one degenerate row. It is
 * the same argument dissolved cards leave the list on. Reversing it is one branch.
 *
 * ⚠ `truncated` IS NOT DECORATION (INVARIANTS §9): at the ceiling is
 * indistinguishable from over it, so a clipped list that renders like an exhausted
 * one is the bug. It is measured on the ROWS READ, before the empty-member filter,
 * because the ceiling is what the database applied.
 */
export async function listChannelArtifacts(
  ctx: ChannelContext,
  ref: string
): Promise<{ artifacts: ChannelFoldedArtifact[]; truncated: boolean }> {
  const { channel } = await loadVisibleChannel(ctx, ref);
  const rows = await repoArtifacts.listArtifactsByChannel(
    channel.id,
    CHANNEL_ARTIFACT_LIST_LIMIT
  );
  const spans = await repoArtifacts.artifactSpans(
    channel.id,
    rows.map((row) => row.id)
  );
  const artifacts: ChannelFoldedArtifact[] = [];
  for (const row of rows) {
    const span = spans.get(row.id);
    if (span === undefined) continue;
    artifacts.push({
      artifact: mapArtifactRow(row),
      count: span.count,
      firstSeq: span.firstSeq,
      lastSeq: span.lastSeq,
    });
  }
  return { artifacts, truncated: rows.length >= CHANNEL_ARTIFACT_LIST_LIMIT };
}
