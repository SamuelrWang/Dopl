/**
 * INTENT → CAPABILITY (C4, D4). `deliver` names an intent; the router needs the capability a device
 * must have. Each intent lists acceptable capabilities in preference order; the first one the chosen
 * device supports is used. Pure. `show` / `ask` / `notify` are SDK helpers over these, not routes.
 */
import type { CapabilityId, DeliverContent, DeliverIntent, DisplayBlock } from "../types";

export function capabilitiesFor(intent: DeliverIntent, content: DeliverContent): CapabilityId[] {
  switch (intent) {
    case "message":
      return ["present.display", "present.notify", "present.speak"];
    case "notify":
      return ["present.notify", "present.display"];
    case "display":
      return ["present.display"];
    case "ask": {
      const hasChoice = (content.options?.length ?? 0) >= 2 || (content.blocks ?? []).some((b) => b.type === "choice");
      return hasChoice ? ["ask.choice"] : ["ask.text", "ask.confirm"];
    }
  }
}

const textBlock = (content: string): DisplayBlock => ({ id: "text", type: "text", content });

/** The adapter args for one capability, built from the (already enforced) content. No text is altered. */
export function argsFor(capability: CapabilityId, content: DeliverContent): Record<string, unknown> {
  const text = content.text;
  switch (capability) {
    case "present.display":
      return { blocks: content.blocks ?? (text !== undefined ? [textBlock(text)] : []) };
    case "present.notify":
      return { body: text ?? "", ...(content.blocks ? { blocks: content.blocks } : {}) };
    case "present.speak":
      return { text: text ?? "" };
    case "ask.choice": {
      const choice = content.blocks?.find((b) => b.type === "choice");
      const options = content.options ?? (choice?.type === "choice" ? choice.options : []);
      return { question: text ?? "", options, ...(content.blocks ? { blocks: content.blocks } : {}) };
    }
    default:
      return { question: text ?? "", ...(content.blocks ? { blocks: content.blocks } : {}) };
  }
}

export const isAsk = (capability: CapabilityId): boolean => capability.startsWith("ask.");
