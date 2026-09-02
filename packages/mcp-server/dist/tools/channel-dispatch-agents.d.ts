/**
 * THE SIX AGENT-LIFECYCLE OPS OF `dopl_channel`, DISPATCHED — `direct_agent`,
 * `read_directions`, `launch_agent`, `end_agent`, `rename_agent` and
 * `set_agent_mode`.
 *
 * ⚠ SPLIT OUT OF `channel.ts` ON 2026-09-01, when integrating four tiers pushed
 * that file to 551 over the §1 cap of 500 (`set_agent_mode` from the
 * orchestrator-surface tier, `ping`/`pings` from the needs-you-ping tier). The
 * seam is not arithmetic: these six are the ops that ASK THE OPERATOR'S OWN
 * MACHINE to do something. Each files a directive and holds for an answer, each
 * can come back `refused` out of one closed vocabulary, and no other op on this
 * tool reads that vocabulary at all.
 *
 * 🔒 **IT TAKES `args` AND `client` AND NOTHING ELSE, AND THAT IS THE FENCE
 * RESTATED RATHER THAN A CONVENIENCE.** None of the six reads the caller
 * identity, the runtime stamp, the admin flag or the container lock: an agent
 * verb reaches the caller's OWN operator BY CONSTRUCTION, because the server
 * stamps the authenticated caller and there is no argument on this lane that
 * could name anybody else. ⚠ Adding a parameter here is how that stops being
 * true, so a widening needs the argument for why, in writing.
 *
 * ⚠ THE `op` UNION IS NARROWED BY THE CALLER'S GROUPED `case`, so this switch is
 * exhaustive over exactly those six and needs no `default`. `channel.ts`'s own
 * switch has no `default` either — its exhaustiveness over the whole op union is
 * what proves the handler always returns — and delegating a GROUP rather than
 * six one-liners keeps that property on both sides.
 *
 * ⚠ `channel-` filename prefix is REQUIRED: the parity split-scan
 * (`parity.test.ts`) and the removed-vocabulary source scan
 * (`channel-law.test.ts`, `law-scan.test.ts`) read every non-test `channel-*.ts`
 * in this directory.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
import type { z } from "zod";
import type { ZodObject } from "zod";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";
/**
 * The six ops this module answers. ⚠ Restated rather than imported from the
 * schema's `op` enum, because the whole value of the narrow type is that this
 * file CANNOT answer a seventh: widening the enum in `channel-schema.ts` must
 * not silently widen what the caller may route here.
 */
type AgentOp = "direct_agent" | "read_directions" | "launch_agent" | "end_agent" | "rename_agent" | "set_agent_mode";
/** The validated argument bag, exactly as `channel.ts`'s handler receives it. */
type ChannelArgs = z.infer<ZodObject<typeof CHANNEL_INPUT_SHAPE>>;
/**
 * ⚠ **`op` IS PASSED SEPARATELY FROM `args`, AND IT IS NOT REDUNDANT.**
 * `CHANNEL_INPUT_SHAPE` is ONE object type with an `op` enum, not a
 * discriminated union, so the caller's grouped `case` narrows `args.op` but NOT
 * `args` — TypeScript has nothing to discriminate on. Taking the narrowed op as
 * its own parameter carries that narrowing across the call, which is what makes
 * the switch below exhaustive over exactly six words and lets this function
 * return without a `default` that could only throw.
 */
export declare function dispatchAgentOp(op: AgentOp, args: ChannelArgs, client: DoplClient): Promise<ToolResponse>;
export {};
