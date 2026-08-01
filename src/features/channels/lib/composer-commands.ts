/**
 * Composer SLASH COMMANDS — the one extensible list, and its parser.
 *
 * A slash command is typed into the ordinary message input and SENT like a
 * message; the composer intercepts it before the post. Only a whole-input
 * command counts (`/new-agent` as the entire draft) — a slash inside prose is
 * prose, and an UNKNOWN command is prose too, so `/deploy now` posts as text
 * rather than being swallowed by a surface that doesn't implement it.
 *
 * Pure + list-driven so the hint row, the parser, and any future command stay
 * in agreement: adding a command here adds it everywhere.
 */

export interface SlashCommandSpec {
  /** The token after the slash (no leading `/`). */
  name: string;
  /** What the hint row shows. */
  usage: string;
  /** One line of what it does. */
  hint: string;
}

/** Every command the composer implements. v1: exactly one. */
export const SLASH_COMMANDS: readonly SlashCommandSpec[] = [
  {
    name: "new-agent",
    usage: "/new-agent [name]",
    hint: "Summon an agent of your own into this channel.",
  },
];

/** The command that summons an agent (referenced by the composer + tests). */
export const NEW_AGENT_COMMAND = "new-agent";

export interface ParsedSlashCommand {
  /** A name from {@link SLASH_COMMANDS} — unknown commands never parse. */
  name: string;
  /** The remainder after the command word, trimmed; null when absent. */
  arg: string | null;
}

/**
 * True while the draft LOOKS like a command (starts with `/`), which is when
 * the hint row shows. Deliberately looser than {@link parseSlashCommand}: the
 * hint is a discovery affordance, so it appears on the first keystroke.
 */
export function isSlashDraft(value: string): boolean {
  return value.trimStart().startsWith("/");
}

/** The commands whose name starts with what has been typed so far. */
export function matchingSlashCommands(value: string): SlashCommandSpec[] {
  if (!isSlashDraft(value)) return [];
  const typed = value.trimStart().slice(1).split(/\s+/)[0].toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(typed));
}

/**
 * Parse a whole-input command, or null. Null covers every "this is a message"
 * case: no leading slash, a slash mid-prose, and an unknown command name.
 */
export function parseSlashCommand(value: string): ParsedSlashCommand | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return null;
  const [word, ...rest] = trimmed.slice(1).split(/\s+/);
  const name = word.toLowerCase();
  if (!SLASH_COMMANDS.some((c) => c.name === name)) return null;
  const arg = rest.join(" ").trim();
  return { name, arg: arg.length > 0 ? arg : null };
}
