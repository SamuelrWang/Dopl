import { menuHandlers, preflight } from "@/features/glasses/glasses-runtime";

/** Glasses menu: agents in a channel (docs/glasses-mcp.md › Menu). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ channelId: string }> };

export const OPTIONS = preflight;
export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  return menuHandlers.agents(request, (await ctx.params).channelId);
}
