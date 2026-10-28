import "server-only";
import { after } from "next/server";
import { glassesMessageSource } from "@/features/channels/server/message-source-stamp";
import { platformOf, type GlassesDeps } from "@/features/glasses/core/messages/service";
import { GLASSES_LIMITS as GL, cleanField, cleanList } from "@/features/glasses/core/validation";
import { EVEN_G2_INFO } from "@/features/glasses/platforms/even-g2/info";
import type { ChoiceBlock, DisplayAnswerStamp, DisplayBlock, DisplayLayout, Positioned } from "../core/types";
import { answerDecisionFromLens } from "./answer";
import { createSdkLens, SdkLensError, type SdkAskOutcome, type SdkLens, type SdkUserLens } from "./sdk-lens";

/**
 * The display seam's SDK half (W1.2): WHICH lens copies the SDK carries, and the lens-answer bridge.
 *
 * 🔒 FAITHFUL OR NOT AT ALL. The SDK path takes a lens copy only when the frozen contract can carry it
 * unchanged: a stack (no absolute layout) that fits the G2 at degradation level 0 (the SDK's even_g2
 * compiles level 0 only, D3), or a choice that IS an ask card (one heading/text line as the question,
 * 2-4 options; or the `glasses_ask` shortcut). Anything else keeps the prosumer lens copy, which a
 * migrated G2 still reads (`device-handlers.ts › mergedQueue`); every such case is logged
 * (`evt:"display_shown", path:"prosumer_fallback", fallback_reason`).
 */

export type ShowDeps = GlassesDeps & { sdk?: SdkLens };

export type SdkPlan = { kind: "screen" } | { kind: "ask"; question: string; options: string[] } | { kind: "none"; reason: string };

/** What the SDK path does with this lens copy. Throws (like the prosumer path) on a bad `glasses_ask`. */
export function sdkPlanOf(
  deps: GlassesDeps,
  a: { blocks: Positioned<DisplayBlock>[]; layout: DisplayLayout; level: number; choice: ChoiceBlock | null; question: string; shortcut: "render" | "ask" | null }
): SdkPlan {
  const sanitize = platformOf(deps).sanitizeText;
  if (a.shortcut === "ask" && a.choice) {
    // The same checks and messages as the prosumer `pushAsk`.
    const question = cleanField(sanitize, "question", a.question, GL.question);
    const options = cleanList(sanitize, "options", a.choice.options.map((o) => o.label), GL.options, GL.option);
    return { kind: "ask", question, options };
  }
  if (a.layout === "absolute") return { kind: "none", reason: "absolute layout" };
  if (a.level > 0) return { kind: "none", reason: `degraded level ${a.level}` };
  if (!a.choice) return { kind: "screen" };
  const rest = a.blocks.filter((b) => b.type !== "choice");
  if (rest.length > 1 || (rest[0] && rest[0].type !== "heading" && rest[0].type !== "text")) return { kind: "none", reason: "choice beside other blocks" };
  try {
    const question = cleanField(sanitize, "question", a.question, GL.question);
    const options = cleanList(sanitize, "options", a.choice.options.map((o) => o.label), GL.options, GL.option);
    return { kind: "ask", question, options };
  } catch {
    return { kind: "none", reason: "choice exceeds the ask card" };
  }
}

/** Production: the `sdk_delivery` flag and the Dopl App key from the server env. */
export const productionSdkLens: SdkLens = createSdkLens();

/**
 * The user's SDK lens, or null (no SDK wired, flag off, or the SDK path is unavailable: prosumer path).
 *
 * 🔒 PER DEVICE: the SDK lens copy reaches only MIGRATED glasses. A user who also has a glasses link
 * that is NOT migrated (paired after the migration) keeps the prosumer lens copy, which every one of
 * their devices reads (a migrated one through its merged inbox), so no device misses it.
 */
export async function sdkLensFor(deps: ShowDeps, userId: string): Promise<{ lens: SdkUserLens | null; unavailable?: string }> {
  const sdk = deps.sdk;
  if (!sdk) return { lens: null };
  let sel: Awaited<ReturnType<SdkLens["forUser"]>>;
  try {
    sel = await sdk.forUser(userId);
  } catch (err) {
    if (err instanceof SdkLensError) return { lens: null, unavailable: err.code };
    throw err;
  }
  if (!sel) return { lens: null };
  const links = await deps.devices.listDevices(userId);
  if (links.some((d) => !sel.deviceIds.includes(d.id))) return { lens: null, unavailable: "unmigrated device" };
  return { lens: sel.lens };
}

export interface LensAnswer {
  outcome: SdkAskOutcome;
  /** The decision's answer stamp, when the lens answer was posted to the channel. */
  stamp?: DisplayAnswerStamp;
}

/**
 * The SDK ask's outcome, BRIDGED: a lens answer to a channel decision posts there as the owner, from
 * glasses (the prosumer `answerLinked` does the same for a lens tap). A decision already answered in
 * the channel keeps that answer; the lens answer is dropped (logged).
 */
export function bridgeLensAnswer(ask: Promise<SdkAskOutcome>, a: { userId: string; messageId: string | null; decision: boolean }): Promise<LensAnswer> {
  return ask.then(async (outcome) => {
    if (outcome.status !== "answered" || !a.messageId || !a.decision) return { outcome };
    const source = glassesMessageSource({ id: outcome.deviceId ?? "", name: "", platform: EVEN_G2_INFO.id });
    const posted = await answerDecisionFromLens(a.userId, a.messageId, outcome.index, source);
    console.info("[display] " + JSON.stringify({ evt: "sdk_lens", op: "bridge", outcome: posted.result, answer_ms: outcome.ms }));
    return posted.result === "ok" ? { outcome, stamp: posted.answer } : { outcome };
  });
}

/** Keep a lens-answer bridge running past the response (`after`), or detached where there is no request. */
export function keepAlive(p: Promise<unknown>): void {
  const run = () => p.catch((err) => console.error("[display] sdk lens bridge failed", err));
  try {
    after(run);
  } catch {
    // `after()` throws outside a request scope (scripts, tests).
    void run();
  }
}
