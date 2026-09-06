/**
 * `op="artifact"` — FOLD A RUN OF MESSAGES INTO ONE CARD, after the fact
 * (design #1220 §5, accepted wholesale at #1222).
 *
 * An artifact is a thread formed AFTER the fact: a name + summary standing in
 * for a set of main-room messages that already exist. ⚠ **IT IS A VIEW
 * DECISION, NOT AN EDIT.** Every folded message keeps its body, author,
 * metadata and `seq`; a folded read renders the card where the run was, and an
 * unfolded read is unchanged. That is the whole safety argument for offering
 * `dissolve` at all — see below.
 *
 * ⚠ **THE DISPATCH AND THE RENDER ARE IN ONE FILE, WHERE `manage` AND `rooms`
 * SPLIT THEIRS**, and the difference is real rather than sloppy. Those two
 * dispatchers fan out to eight and five handlers with a result vocabulary each;
 * these four actions share ONE result shape (`ChannelArtifactResult`) and
 * therefore ONE renderer, so a `channel-dispatch-artifacts.ts` holding a
 * five-line switch would split a single vocabulary across two files and give
 * the card two places to be described.
 *
 * ⚠ **THERE IS NO `delete`, AND THAT IS THE SAFETY ARGUMENT** (design §5 and
 * `schema-artifacts.ts`'s own header): `dissolve` clears the column from every
 * member and retires the card. Nothing is deleted, no body is touched, and the
 * messages come straight back into the transcript — which is what keeps this op
 * inside the tool's published `no delete op` policy.
 *
 * ⚠ `channel-` filename prefix is REQUIRED: the parity split-scan
 * (`parity.test.ts`) and the removed-vocabulary source scan
 * (`law-scan.test.ts`) read every non-test `channel-*.ts` in this directory.
 */

import type {
  ChannelArtifactAction,
  ChannelArtifactResult,
  DoplClient,
} from "@dopl/client";
import { inlineOr } from "./narration";
import { err, missingParams, ok, type ToolResponse } from "./respond";
import { isErr, resolveChannelOr } from "./channel-shared";
import {
  CHANNEL_ACTIONS,
  CHANNEL_INPUT_SHAPE,
  type ArtifactAction,
} from "./channel-schema";
import type { z } from "zod";
import type { ZodObject } from "zod";

/** The validated argument bag, exactly as `channel.ts`'s handler receives it. */
type ChannelArgs = z.infer<ZodObject<typeof CHANNEL_INPUT_SHAPE>>;

/**
 * True for an action this module answers. ⚠ **THE THIRD VOCABULARY**, and the
 * pairing is checked in `channel.ts` for the same reason the other two are:
 * `action` is ONE flat enum over three disjoint lists, so the schema cannot
 * express "this word belongs to that op" and `artifact(action="launch")` has to
 * be refused before it reaches a switch with no arm for it.
 */
export function isArtifactAction(action: string): action is ArtifactAction {
  return (CHANNEL_ACTIONS.artifact as readonly string[]).includes(action);
}

/**
 * ⚠ **ONE `messages` PARAM FOR ALL THREE ACTIONS THAT NAME MESSAGES**, and the
 * "exactly one" rule for `add` / `remove` is enforced HERE rather than in the
 * schema — the same seam, and for the same reason, as the action pairing above.
 * The alternative was a second param (`message`, singular) whose only job was to
 * be the first one with a different bound, which is how a caller learns to guess
 * which spelling an action wants. The route's own shape keeps both spellings
 * because its union is per-action; this is the flat published surface, and the
 * mapping happens at this seam.
 */
function oneMessage(
  action: "add" | "remove",
  messages: number[],
): number | ToolResponse {
  if (messages.length !== 1) {
    return err(
      `op="artifact" action="${action}" takes exactly ONE seq in \`messages\`, and ${messages.length} were named — nothing was changed. It moves one message at a time by design; loop it, or name the whole set on action="create".`,
    );
  }
  return messages[0]!;
}

/**
 * Build the route's per-action shape from the flat published one, or refuse.
 *
 * ⚠ REFUSE-BEFORE-SEND, on the pairings the route would answer with an opaque
 * 400: a discriminated union rejects a `dissolve` with no `artifact` somewhere
 * less honest than here, and `missingParams` names the field AND the action.
 */
function toAction(
  action: ArtifactAction,
  args: ChannelArgs,
): ChannelArtifactAction | ToolResponse {
  switch (action) {
    case "create": {
      const miss = missingParams('artifact action="create"', args, [
        "name",
        "messages",
      ]);
      if (miss) return miss;
      return {
        action: "create",
        name: args.name as string,
        // ⚠ `summary` is the tool's one-line-intent field everywhere else on
        // this surface, and an artifact's summary is that same sentence about a
        // run. Absent is legal: a good name and no summary is a normal card.
        summary: args.summary,
        messages: args.messages as number[],
        // ⚠ THE RETRY KEY, and the one field an AGENT must not omit. Without it
        // a retried create makes a SECOND card over messages the first already
        // took, and half the run ends up in each.
        clientMsgId: args.client_msg_id,
      };
    }
    case "add":
    case "remove": {
      const miss = missingParams(`artifact action="${action}"`, args, [
        "artifact",
        "messages",
      ]);
      if (miss) return miss;
      const one = oneMessage(action, args.messages as number[]);
      if (isErr(one)) return one;
      return { action, artifact: args.artifact as string, message: one };
    }
    case "dissolve": {
      const miss = missingParams('artifact action="dissolve"', args, [
        "artifact",
      ]);
      if (miss) return miss;
      return { action: "dissolve", artifact: args.artifact as string };
    }
  }
}

/**
 * ⚠ **THE SEQS THAT DID NOT FOLD ARE REPORTED, NEVER COUNTED AWAY.** `folded`
 * may be shorter than `requested` — a seq that does not exist, or that is
 * already in another artifact, simply does not fold — and a bare "folded 7
 * messages" would hide exactly the half the caller needs to see. This is the
 * tool's own `Results report only what the call DID` rule applied to a partial
 * success, which is the shape this op has most often.
 */
function foldLine(result: ChannelArtifactResult): string {
  const missed = result.requested.filter((s) => !result.folded.includes(s));
  const folded = `Folded ${result.folded.length} of ${result.requested.length} named message(s).`;
  if (missed.length === 0) return folded;
  return `${folded} NOT folded: ${missed.map((s) => `#${s}`).join(", ")} — a seq that does not exist, or that is already in another artifact, does not move.`;
}

/** The seq span, or "" when nothing folded. ⚠ Read off what FOLDED. */
function spanLine(result: ChannelArtifactResult): string[] {
  if (result.folded.length === 0) return [];
  const lo = Math.min(...result.folded);
  const hi = Math.max(...result.folded);
  return [lo === hi ? `Covers #${lo}.` : `Covers #${lo}–#${hi}.`];
}

/**
 * Render one write.
 *
 * ⚠ **THE NAME AND SUMMARY ARE PEER-AUTHORED AND GO THROUGH `inlineOr`.** A
 * card in a shared room is named by whoever is in that room, which in a home
 * channel is a peer — so both strings are VALUES spliced into a line we wrote,
 * never structure. Same rule, same neutralizer, as the info card's rows.
 */
function render(action: ArtifactAction, result: ChannelArtifactResult): string {
  const name = inlineOr(result.artifact.name, "`(unnamed)`");
  const head =
    action === "dissolve"
      ? `Dissolved **${name}**. Nothing was deleted: every message it held is back in the transcript, and the card still resolves by id.`
      : action === "create"
        ? `Created artifact **${name}** (id: \`${result.artifact.id}\`).`
        : action === "add"
          ? `Added to **${name}**.`
          : `Removed from **${name}**.`;

  const lines = [head];
  if (action !== "dissolve") {
    lines.push(foldLine(result), ...spanLine(result));
    const summary = result.artifact.summary?.trim();
    if (summary) lines.push(`Summary: ${inlineOr(summary, "`(empty)`")}`);
  }
  lines.push(
    "",
    // ⚠ THE HONESTY SENTENCE, on the WRITE as well as in the tool description
    // (design §4). A caller that folds a run and then reads the room back sees
    // FEWER rows than it wrote, and without this it reads a successful fold as
    // messages having gone missing.
    `⚠ A read of this channel now shows this CARD where those messages were. Nothing was edited or deleted — every message keeps its body, author and \`seq\`, a thread-scoped read never folds, and \`dissolve\` puts them back.`,
  );
  return lines.join("\n");
}

/**
 * `op="artifact"` — create / add / remove / dissolve, one POST each.
 *
 * ⚠ THE CHANNEL IS RESOLVED FIRST, like every other write on this surface: the
 * route takes an id, and a caller that passed a slug would otherwise get a 404
 * about a channel that exists.
 */
export async function dispatchArtifactAction(
  action: ArtifactAction,
  args: ChannelArgs,
  client: DoplClient,
): Promise<ToolResponse> {
  const miss = missingParams("artifact", args, ["channel"]);
  if (miss) return miss;

  const built = toAction(action, args);
  if (isErr(built)) return built;

  const channel = await resolveChannelOr(client, args.channel as string);
  if (isErr(channel)) return channel;

  const result = await client.writeChannelArtifact(
    channel.id,
    built as ChannelArtifactAction,
  );
  return ok(render(action, result));
}
