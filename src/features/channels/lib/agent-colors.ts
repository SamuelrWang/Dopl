/**
 * **THE AGENT COLOUR BANK** — the sixteen keys and the token each one names (Samuel,
 * 2026-09-13; docs/specs/agent-colors.md). Which free key a new agent gets is
 * `agent-color-pick.ts` (most distinct from the live ones, 2026-10-08).
 *
 * ⚠ **NO COLOUR VALUE APPEARS IN THIS FILE OR IN ANY COMPONENT.** A key maps to a
 * CSS custom property NAME and nothing else; the sixteen `oklch()` values live once
 * per tree in `src/app/globals.css` and `apps/desktop-ui/src/styles/tokens.css`,
 * which `scripts/check-css-token-drift.ts` holds together. That is the
 * docs/DESIGN-SYSTEM.md rule ("never hardcode hex colors … in components") applied
 * to a palette whose member is chosen by DATA: a Tailwind class cannot be built from
 * a runtime key without either sixteen literal classes or a safelist, so the
 * reference crosses as `var(--agent-color-NN)` and the paint stays in the token
 * layer.
 *
 * ⚠ **`AGENT_COLOR_KEYS`'s ORDER IS NO LONGER THE ASSIGNMENT POLICY** (2026-10-08). It
 * decides only the empty room's first key, the picker's last tie-break and the order the
 * New-agent popup draws its circles in. The pick itself measures colour distance
 * (`agent-color-pick.ts`), because neighbouring keys are neighbouring hues.
 *
 * ⚠ **IT IS A PLAIN MODULE, NOT `@dopl/contracts`.** That package is TYPE-ONLY by
 * rule (its index carries the argument: one runtime export makes it a build input
 * for four toolchains and re-opens the committed-`dist/` problem), so the TYPE lives
 * there as `AgentColorKey` and the ARRAY lives here — tied together by the
 * `satisfies` below, which is a compile error the day the two disagree.
 */
import type { AgentColorKey } from "@dopl/contracts";

/**
 * The bank, in display order. ⚠ SIXTEEN, which is Samuel's *"a good amount of
 * colors because it might usually have a lot of agents"* measured against the agent
 * cap (15 per workspace, 2026-09-01) — one more than the most agents that can be
 * live at once, so a full room still has a spare rather than an uncoloured agent.
 *
 * ⚠ `satisfies readonly AgentColorKey[]` AND NOT `: readonly AgentColorKey[]`. The
 * annotation would widen the element type and lose the literals, which is what
 * {@link isAgentColorKey}'s narrowing and every `AgentColorKey` call site need. The
 * `satisfies` keeps the tuple AND fails the build if a key here is not in the union.
 */
export const AGENT_COLOR_KEYS = [
  "agent-01",
  "agent-02",
  "agent-03",
  "agent-04",
  "agent-05",
  "agent-06",
  "agent-07",
  "agent-08",
  "agent-09",
  "agent-10",
  "agent-11",
  "agent-12",
  "agent-13",
  "agent-14",
  "agent-15",
  "agent-16",
] as const satisfies readonly AgentColorKey[];

/** ⚠ A `Set` built ONCE at module scope, because {@link isAgentColorKey} is called
 *  per session row per render on a surface that re-renders at telemetry rate. */
const KEY_SET: ReadonlySet<string> = new Set<string>(AGENT_COLOR_KEYS);

/**
 * A MEMBERSHIP TEST, NEVER A CAST — the same discipline
 * `collab-dto.ts › narrowSessionDetail` applies to `detail`, and for the same
 * reason: the value arrives from a TEXT column and from a peer's machine, and a
 * newer desktop may one day report a seventeenth key. An unknown key must read as
 * "no colour" (the neutral box) rather than reach a `var(--agent-color-…)` that
 * resolves to nothing and paints an invisible border.
 */
export function isAgentColorKey(value: unknown): value is AgentColorKey {
  return typeof value === "string" && KEY_SET.has(value);
}

/** {@link isAgentColorKey} as a narrowing coercion — the one shape every DTO and
 *  index mapper wants. ⚠ `null` for absent, unknown AND malformed alike: all three
 *  mean "this surface has no colour to draw", and distinguishing them would put a
 *  branch on every renderer for a difference no reader can see. */
export function agentColorOrNull(value: unknown): AgentColorKey | null {
  return isAgentColorKey(value) ? value : null;
}

/**
 * ONE KEY → THE CSS CUSTOM PROPERTY REFERENCE. `agent-03` ⇒
 * `var(--agent-color-03)`.
 *
 * ⚠ **THE ONLY PLACE THE TOKEN NAMING CONVENTION IS SPELLED**, so a palette rename
 * is one edit here plus the two CSS files. Every consumer passes the result into an
 * inline `style` (`backgroundColor`, `--tw-ring-color`) — see
 * `channels/components/agent-box-rule.ts › agentPostAccent`.
 * ⚠ IT TAKES A NARROWED KEY, so it cannot be handed arbitrary text: the string
 * substitution is safe by TYPE rather than by escaping.
 */
export function agentColorVar(key: AgentColorKey): string {
  return `var(--agent-color-${key.slice("agent-".length)})`;
}

/** Every key nobody holds, in BANK order — what the New-agent popup renders as selectable and
 *  its arrow keys walk. ⚠ NOT the assignment order: the pick, and the list a 409 hands back,
 *  are `agent-color-pick.ts › rankFreeAgentColors` (best first). */
export function freeAgentColors(
  taken: ReadonlySet<string>
): readonly AgentColorKey[] {
  return AGENT_COLOR_KEYS.filter((key) => !taken.has(key));
}
