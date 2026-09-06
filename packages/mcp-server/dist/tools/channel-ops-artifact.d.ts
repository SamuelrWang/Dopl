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
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
import { CHANNEL_INPUT_SHAPE, type ArtifactAction } from "./channel-schema";
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
export declare function isArtifactAction(action: string): action is ArtifactAction;
/**
 * `op="artifact"` — create / add / remove / dissolve, one POST each.
 *
 * ⚠ THE CHANNEL IS RESOLVED FIRST, like every other write on this surface: the
 * route takes an id, and a caller that passed a slug would otherwise get a 404
 * about a channel that exists.
 */
export declare function dispatchArtifactAction(action: ArtifactAction, args: ChannelArgs, client: DoplClient): Promise<ToolResponse>;
export {};
