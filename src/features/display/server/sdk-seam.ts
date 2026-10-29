import "server-only";
import { platformOf, type GlassesDeps } from "@/features/glasses/core/messages/service";
import { GLASSES_LIMITS as GL, cleanField, cleanList } from "@/features/glasses/core/validation";
import type { ChoiceBlock, DisplayBlock, DisplayLayout, Positioned } from "../core/types";
import { createSdkLens, SdkLensError, type SdkLens, type SdkUserLens } from "./sdk-lens";

/**
 * The display seam's SDK half (W1.2): WHICH lens copies the SDK carries. The lens answer to an SDK ask
 * is bridged on the glasses' answer route (`answer.ts › answerFromSdkLens`, gap #3), not here.
 *
 * 🔒 FAITHFUL OR NOT AT ALL. The SDK path takes a lens copy only when the frozen contract can carry it
 * unchanged: a stack (no absolute layout) that fits the G2 at degradation level 0 (the SDK's even_g2
 * compiles level 0 only, D3), or a choice that IS an ask card (one heading/text line as the question,
 * 2-4 options; or the `glasses_ask` shortcut), and never a display the caller named by `display_id`
 * (a replace: Gap #11). Anything else keeps the prosumer lens copy, which a
 * migrated G2 still reads (`device-handlers.ts › mergedQueue`); every such case is logged
 * (`evt:"display_shown", path:"prosumer_fallback", fallback_reason`).
 */

export type ShowDeps = GlassesDeps & { sdk?: SdkLens };

export type SdkPlan = { kind: "screen" } | { kind: "ask"; question: string; options: string[] } | { kind: "none"; reason: string };

/** What the SDK path does with this lens copy. Throws (like the prosumer path) on a bad `glasses_ask`. */
export function sdkPlanOf(
  deps: GlassesDeps,
  a: {
    blocks: Positioned<DisplayBlock>[];
    layout: DisplayLayout;
    level: number;
    choice: ChoiceBlock | null;
    question: string;
    shortcut: "render" | "ask" | null;
    /** The caller named the `display_id` (`screen_id`): a replace, or a screen it means to replace later. */
    explicitId?: boolean;
  }
): SdkPlan {
  const sanitize = platformOf(deps).sanitizeText;
  // Gap #11: the contract has no replace-by-id (the even_g2 dispatcher gives every SDK screen a fresh
  // card id), so a named display would STACK on the lens and `glasses_update` could not find it. The
  // prosumer copy replaces in place by `card_id`. Replace-by-id over the SDK = P4.
  if (a.explicitId) return { kind: "none", reason: "explicit display_id" };
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
