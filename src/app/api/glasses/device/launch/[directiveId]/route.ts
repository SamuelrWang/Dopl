import { menuHandlers, preflight } from "@/features/glasses/glasses-runtime";

/** Glasses menu: status of a launch still in progress (docs/glasses-mcp.md › Menu). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ directiveId: string }> };

export const OPTIONS = preflight;
export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  return menuHandlers.launchStatus(request, (await ctx.params).directiveId);
}
