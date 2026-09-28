import { menuHandlers, preflight } from "@/features/glasses/glasses-runtime";

/** Glasses read mode: channel messages, paged or long-polled (wait <= 20s) (docs/glasses-mcp.md › Menu). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ channelId: string }> };

export const OPTIONS = preflight;
export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  return menuHandlers.messages(request, (await ctx.params).channelId);
}
