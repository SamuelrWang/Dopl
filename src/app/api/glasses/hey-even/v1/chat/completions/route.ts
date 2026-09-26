import "server-only";
import { preflight } from "@/features/glasses/device";
import { heyEvenPost } from "@/features/glasses/hey-even-route";

/** Hey Even (OpenAI chat-completions) → linked Dopl channel. docs/glasses-mcp.md. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export function OPTIONS(request: Request): Response {
  return preflight(request);
}

export const POST = heyEvenPost;
