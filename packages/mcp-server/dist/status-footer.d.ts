/**
 * status-footer.ts — the `_dopl_status` footer and the wrapper that puts it on
 * a meta-tool's response. ⚠ Both registration helpers in `registrar.ts` end
 * here; that is what makes the footer uniform.
 */
import { type CallerIdentity } from "./tools/identity.js";
import { type ResponseFormat } from "./tools/response-size.js";
import type { ToolResponse } from "./tools/respond.js";
import type { EffectiveWorkspace } from "./workspace-directory.js";
/**
 * 🔒 **THE `response_format` A CALL ASKED FOR, READ OFF THE RAW ARGS** (S37/S54,
 * 2026-09-18).
 *
 * ⚠ **THE KNOB IS APPLIED IN THE RENDERERS AND THE FOOTER IS APPENDED AFTER
 * THEM** (`response-size.ts`'s header states the first half), so the footer was
 * the one part of a response the knob could never reach — and it is pure
 * metadata, which is exactly what `concise` promises to drop. A promise a
 * surface visibly does not keep is worse than no knob: an agent that catches one
 * stops spending the other.
 *
 * ⚠ **DUCK-TYPED, LIKE {@link Gates.requestedOp} BESIDE IT.** Arguments arrive
 * off an MCP wire as unvalidated JSON and each tool declares the field for
 * itself; a value that is not the literal `"concise"` reads as the default, so a
 * tool that does not publish the knob cannot be given one by a caller.
 */
export declare function requestedFormat(args: unknown): ResponseFormat | undefined;
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
 *
 * 🔒 **AND SINCE 2026-09-18, `response_format="concise"` DROPS IT** (S37/S54).
 * `RESPONSE_FORMAT_FIELD` promises the knob *"drops METADATA — timestamps, ids,
 * scope notes, legends"*, and this footer is nothing but those three: who the
 * caller is, which container the call hit, and how that container was chosen.
 * It rode every successful response whatever the caller asked for, which made it
 * the one place the published promise was untrue.
 *
 * ⚠ **THE `note` IS NOT METADATA AND SURVIVES.** It is a fact about what THIS
 * call just did that nothing else reports — a `workspace=` argument that was
 * dropped (`workspace-arg.ts › deprecatedAliasNote`, whose whole value is that
 * *the ignore is REPORTED, not swallowed*) or a call that went unmetered. A
 * concise response therefore carries a one-line footer when there is something
 * to say and none at all when there is not, which is the smallest honest answer.
 *
 * ⚠ **THE CALLER LINE IS STILL UNCONDITIONAL IN THE OTHER DIRECTION** — see the
 * B13 note above. That rule is about a MISSING WORKSPACE silently deleting the
 * identity line; this is a caller explicitly asking for less. The two are not
 * the same event and only one of them is the agent's own choice.
 *
 * 🔒 **AND IT SAYS WHETHER THE BINDING MOVED, NOT ONLY WHERE THIS CALL LANDED**
 * (S29b, 2026-09-18). `container=` routes ONE call through an AsyncLocalStorage
 * override (`registrar.ts`) and changes nothing about the connection, so
 * `active_workspace` legitimately reads differently on two consecutive calls —
 * and an agent watching that line flip has no way to tell a per-call detour from
 * a session that re-bound underneath it. It then addresses the next call from
 * the wrong premise, which is exactly the hunting this surface exists to remove.
 * {@link bindingLine} states it: the override is marked THIS CALL ONLY and the
 * connection's own container is named beside it.
 */
export declare function appendDoplStatus(response: ToolResponse, effective: EffectiveWorkspace | null, caller: CallerIdentity, note?: string | null, format?: ResponseFormat, 
/**
 * ⚠ **THE CONNECTION'S OWN CONTAINER, WHICH IS NOT ALWAYS `effective`** — the
 * registrar's addressed branch passes the per-call override as `effective` and
 * this as the session binding it did NOT change. Omitted means "the same
 * thing", which is what every caller that cannot be addressed away means.
 */
binding?: EffectiveWorkspace | null): Promise<ToolResponse>;
/**
 * Wrap a meta-tool handler so every successful response ends with the
 * `_dopl_status` footer reporting the connection's container (if any).
 */
export declare function withDoplStatus<A extends object>(handler: (args: A) => Promise<ToolResponse>, getEffective: () => EffectiveWorkspace | null, caller: CallerIdentity, 
/** ⚠ READ **AFTER** THE HANDLER, never before — the note it returns is a fact
 *  about what the call just did (today: whether it went unmetered,
 *  `credits-unmetered.ts › unmeteredNote`). Omitted means "no note", which is
 *  what every meta tool answered before 2026-09-14. */
getNote?: () => string | null): (args: A) => Promise<ToolResponse>;
