import { z } from "zod";
import { formatDisplayErrors, normalizeDisplay } from "./normalize";

/**
 * `display` on `POST /api/channels/:id/messages` — the display service's stamping entry
 * (spec D8): blocks + layout only, normalized to v2 here. The display id, hold stamp, lens link
 * and origin are server-owned (`PostMessageOptions.display`), never caller input.
 */
export const DisplayInputSchema = z
  .object({
    blocks: z.array(z.unknown()).min(1),
    layout: z.enum(["stack", "absolute"]).optional(),
  })
  .strict()
  .transform((input, ctx) => {
    const result = normalizeDisplay(input);
    if (!result.ok) {
      ctx.addIssue({ code: "custom", message: formatDisplayErrors(result.errors) });
      return z.NEVER;
    }
    return result.display;
  });

