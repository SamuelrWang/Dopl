import "server-only";
import { NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { findMembership } from "@/features/workspaces/server/repository";

/**
 * Canvas write gate for agent (MCP) callers. The per-member canvas
 * override matrix is gone — teams scope knowledge bases and workflows,
 * not the canvas — so the rule collapses to the role check: member+
 * can write the canvas, viewer cannot. Session callers skip entirely
 * (their routes already carry minRole gates).
 *
 * Returns a NextResponse to short-circuit the handler on denial, or
 * null on success. Pass `role` from the auth context to avoid a
 * membership refetch.
 */
export async function denyIfNoCanvasWrite(ctx: {
  agentTokenId?: string;
  userId: string;
  workspaceId: string;
  role?: Role;
}): Promise<NextResponse | null> {
  if (!ctx.agentTokenId) return null;
  let role = ctx.role;
  if (!role) {
    const membership = await findMembership(ctx.workspaceId, ctx.userId);
    if (!membership || membership.status !== "active") {
      const err = new HttpError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");
      return NextResponse.json(err.toResponseBody(), { status: err.status });
    }
    role = membership.role;
  }
  if (!meetsMinRole(role, "member")) {
    const err = new HttpError(
      403,
      "RESOURCE_ACCESS_DENIED",
      "Your access on this canvas is read-only"
    );
    return NextResponse.json(err.toResponseBody(), { status: err.status });
  }
  return null;
}
