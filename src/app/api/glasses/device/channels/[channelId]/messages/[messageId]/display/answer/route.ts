import { menuHandlers, preflight } from "@/features/glasses/glasses-runtime";

/** Glasses: answer a channel display's options (docs/glasses-mcp.md › Menu › Display messages). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ channelId: string; messageId: string }> };

export const OPTIONS = preflight;
export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { channelId, messageId } = await ctx.params;
  return menuHandlers.displayAnswer(request, channelId, messageId);
}
