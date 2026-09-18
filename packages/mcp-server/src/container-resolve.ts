/**
 * container-resolve.ts — 🔒 **HOW ONE TOOL CALL FINDS ITS CONTAINER** (R-32,
 * Samuel 2026-09-17). The registrar is the mechanism and `workspace-arg.ts` is
 * the policy table; this file is the DECISION, in one place, so the three
 * outcomes a call can have — addressed, unaddressed, refused — are enumerated
 * once rather than spelled out inside a wrapper that also charges credits and
 * appends a footer.
 *
 * ── THE ADDRESS GRAMMAR ────────────────────────────────────────────────────
 *
 *   container=home        → the CALLER's own personal container, per caller
 *   container=<slug>      → a workspace, or a home channel (its channel's slug;
 *                           one channel per link container, minted from the
 *                           same name — `home/server/service-writes.ts ›
 *                           createHomeChannel`)
 *   container=<id>        → any container the caller is an active member of
 *   workspace=<…>         → DEPRECATED alias, same resolver, one release
 *   (omitted)             → the connection's container, else `home`
 *
 * ⚠ **THE LAST LINE IS THE RULING'S POINT AND IT IS STRUCTURE, NOT COPY.** An
 * unaddressed READ resolves to the caller's own container because the SERVER
 * resolves it (B10), not because a prompt told an agent to pass something. An
 * unaddressed MINT is REFUSED — see `workspace-arg.ts ›
 * UNADDRESSED_WRITE_REFUSALS`.
 */

import type { ToolResponse } from "./tools/respond.js";
import { inlineOr } from "./tools/narration.js";
import {
  acceptsWorkspaceArg,
  aliasIgnoredNote,
  deprecatedAliasNote,
  ignoredWorkspaceNote,
  refusesUnaddressedWrite,
  unaddressedWriteRefusal,
} from "./workspace-arg.js";
import { containerKind } from "./workspace-directory.js";
import type {
  ActiveWorkspaceState,
  EffectiveWorkspace,
  WorkspaceDirectory,
} from "./workspace-directory.js";

/** The two spellings, as the caller sent them. */
export interface AddressArgs {
  container?: string;
  /** ⚠ DEPRECATED — mapped to the same resolver for one release. */
  workspace?: string;
}

/**
 * ⚠ THREE OUTCOMES AND NO FOURTH. `addressed` carries the container the call
 * must run in; `unaddressed` leaves the connection's own in place; `refusal` is
 * a finished response and the caller returns it verbatim.
 */
export type AddressOutcome =
  | { kind: "refusal"; response: ToolResponse }
  | { kind: "addressed"; effective: EffectiveWorkspace; note: string | null }
  | { kind: "unaddressed"; note: string | null };

function err(text: string): ToolResponse {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

export interface AddressDeps {
  directory: WorkspaceDirectory;
  /** The container `X-Workspace-Id` bound this connection to, or null. */
  activeWorkspace: ActiveWorkspaceState | null;
}

/**
 * Resolve one call's container.
 *
 * ⚠ **`container=` WINS OVER `workspace=` AND BOTH DROPS ARE ANNOUNCED.** A
 * caller that sent two addresses, or sent one on an op that takes none, is told
 * which one the call used — the whole difference between a deprecation window
 * and a silent re-target (B13's argument, one argument later).
 */
export async function resolveCallAddress(
  tool: string,
  op: string | undefined,
  args: AddressArgs,
  { directory, activeWorkspace }: AddressDeps,
): Promise<AddressOutcome> {
  const usedAlias = args.container === undefined && args.workspace !== undefined;
  const ref = usedAlias ? args.workspace : args.container;
  const argName = usedAlias ? "workspace" : "container";
  const bothSent = args.container !== undefined && args.workspace !== undefined;

  if (!acceptsWorkspaceArg(tool, op)) {
    // ⚠ NO HONOURED ADDRESS. The call runs in this connection's container, and
    // when the connection names none the SERVER resolves the caller's own.
    return {
      kind: "unaddressed",
      note:
        ref === undefined
          ? null
          : ignoredWorkspaceNote(op, typeof ref === "string" ? ref.trim() : "", argName),
    };
  }

  if (ref === undefined) {
    // 🔒 R-32 item 4 — a MINT with no address, on a connection that names no
    // container, would land in the home space. Refuse; do not guess.
    if (refusesUnaddressedWrite(tool, op) && activeWorkspace === null) {
      return { kind: "refusal", response: err(unaddressedWriteRefusal(tool, op ?? "")) };
    }
    return { kind: "unaddressed", note: null };
  }

  // ⚠ "provided but blank" (fail closed) must stay distinct from "not
  // provided". A falsy-string test lets a computed-but-empty ref route a write
  // to a container the caller never named.
  const supplied = typeof ref === "string" ? ref.trim() : "";
  if (!supplied) {
    return {
      kind: "refusal",
      response: err(
        `The \`${argName}\` argument was blank. Pass a container slug or id from \`dopl_workspaces\`, or \`home\` for your home space — or omit it entirely to use this connection's container.`,
      ),
    };
  }

  let resolved;
  try {
    // ⚠ Can throw on network/auth failure — an uncaught throw surfaces as an
    // opaque MCP framework error.
    resolved = await directory.resolveContainerRef(supplied);
  } catch (e) {
    return {
      kind: "refusal",
      response: err(
        `Couldn't validate the \`${argName}\` argument (${inlineOr(
          e instanceof Error ? e.message : String(e),
          "`no detail reported`",
        )}). Try again, or call without \`${argName}=\`.`,
      ),
    };
  }
  if (!resolved) {
    return {
      kind: "refusal",
      // ⚠ Caller's own arg, but a raw backtick still escapes this span and puts
      // the tail into narration.
      response: err(
        `Container not found: ${inlineOr(supplied, "`(unreadable ref)`")}. Call \`dopl_workspaces\` for every container you can reach — workspaces, home channels and your home space alike; \`home\` names the last of those.`,
      ),
    };
  }
  return {
    kind: "addressed",
    effective: {
      id: resolved.id,
      slug: resolved.slug,
      name: resolved.name,
      role: resolved.role,
      kind: containerKind(resolved),
      source: "per-call arg",
    },
    note: bothSent ? aliasIgnoredNote() : usedAlias ? deprecatedAliasNote() : null,
  };
}
