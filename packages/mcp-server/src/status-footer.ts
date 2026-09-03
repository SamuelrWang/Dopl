/**
 * status-footer.ts — the `_dopl_status` footer and the wrapper that puts it on
 * a meta-tool's response. ⚠ Both registration helpers in `registrar.ts` end
 * here; that is what makes the footer uniform.
 */

import { callerStatusLine, type CallerIdentity } from "./tools/identity.js";
import { inlineOr } from "./tools/narration.js";
import { UNNAMED_WORKSPACE } from "./instructions.js";
import type { ToolResponse } from "./tools/respond.js";
import type { EffectiveWorkspace } from "./workspace-directory.js";

/**
 * Append the mandatory `_dopl_status` footer. ⚠ Reports the EFFECTIVE workspace
 * this call HIT plus a source label (`per-call arg` / `header pin`), and any
 * per-call `note` the registrar wants the agent to see.
 *
 * ⚠ **THE CALLER LINE IS UNCONDITIONAL SINCE B13, AND THE OLD EARLY RETURN WAS
 * THE BUG WAITING TO HAPPEN.** It used to skip the whole footer when there was
 * no effective workspace — harmless while every connection auto-targeted one,
 * and a silent deletion of `caller: id=…` from every response the moment the
 * auto-target went. The server instructions tell every agent that footer opens
 * with its own user id; a workspace it has not got must not take the identity
 * with it.
 *
 * Skipped only when the handler returned `isError` — don't muddy error messages.
 */
export async function appendDoplStatus(
  response: ToolResponse,
  effective: EffectiveWorkspace | null,
  caller: CallerIdentity,
  note?: string | null,
): Promise<ToolResponse> {
  const res = response;
  if (res.isError) return res;

  // ⚠ Name goes through the neutralizer: this footer is the agent's targeting
  // check, so it is the line worth forging, and a name is bounded only by
  // length (see UNTRUSTED_DIRECTORY_NOTE) — one newline buys a second, invented
  // `_dopl_status` key. The slug (kebab-regex) and id (server-issued) beside it
  // are the halves an owner cannot type.
  //
  // ⚠ WHO comes before WHERE: this is the one line riding every successful
  // response, and the instructions tell the agent to read it, so the immutable
  // id must be here rather than hunted for across surfaces that disagree.
  const footer = [
    "",
    "",
    "---",
    "_dopl_status:",
    callerStatusLine(caller),
    // ⚠ An UNBOUND connection names no container rather than guessing one; the
    // server resolves the caller's own when nothing is passed (B10).
    ...(effective
      ? [
          `  active_workspace: ${inlineOr(effective.name, UNNAMED_WORKSPACE)} (slug=\`${effective.slug}\`, id=\`${effective.id}\`, role=${effective.role})`,
          `  workspace_source: ${effective.source}`,
        ]
      : []),
    ...(note ? [`  ${note}`] : []),
  ].join("\n");

  // Append to the final text block; add a new one if there is no text content.
  const content = [...res.content];
  const lastIdx = content.length - 1;
  if (lastIdx >= 0 && content[lastIdx]?.type === "text") {
    content[lastIdx] = {
      type: "text",
      text: `${content[lastIdx].text}${footer}`,
    };
  } else {
    content.push({ type: "text", text: footer.trimStart() });
  }
  return { ...res, content };
}

/**
 * Wrap a meta-tool handler so every successful response ends with the
 * `_dopl_status` footer reporting the connection's container (if any).
 */
export function withDoplStatus<A extends object>(
  handler: (args: A) => Promise<ToolResponse>,
  getEffective: () => EffectiveWorkspace | null,
  caller: CallerIdentity,
): (args: A) => Promise<ToolResponse> {
  return async (args: A) => {
    const result = await handler(args);
    return appendDoplStatus(result, getEffective(), caller);
  };
}
