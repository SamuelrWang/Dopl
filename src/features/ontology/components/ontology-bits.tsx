import { cn } from "@/shared/lib/utils";
import { PILL_BUTTON, SMALL_TEXT_BUTTON } from "@/shared/ui/small-action-button";

/** A value that points at something (an object, a knowledge base, a skill, a link): the outlined
 *  pill, never wider than its cell. Its label goes in a `CHIP_TEXT` span so it truncates. */
export const VALUE_CHIP = cn(PILL_BUTTON, "min-w-0 max-w-full gap-1 pl-1.5 pr-2");

export const CHIP_TEXT = "min-w-0 truncate";

/** The chip's leading glyph. */
export const CHIP_MARK = "flex-none text-text-muted";

/** A lane's or group's `+ <type>`: the next row in the list, not a footer. */
export const ADD_OBJECT_BUTTON = cn(SMALL_TEXT_BUTTON, "-ml-1 min-w-0 max-w-full gap-1 self-start");
