import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { findWorkspaceById } from "./repository";

/**
 * A home channel holds only what is shared into it: a private, ungranted row in a `kind='link'`
 * container is listed nowhere, so the server refuses it on every door.
 */

/**
 * 400, not 403: the caller may author here; the request names a destination that does not exist.
 * Extends `HttpError` so `http-error-response.ts` carries it at every boundary with no mapping arm.
 */
export class HomeChannelRowNotSharedError extends HttpError {
  constructor(message: string) {
    super(400, "HOME_CHANNEL_ROW_NOT_SHARED", message);
    this.name = "HomeChannelRowNotSharedError";
  }
}

export interface HomeChannelDestination {
  /** The container the row lands in, never the one the call stands in. */
  workspaceId: string;
  /** Per feature: the audience column (identity) or a channel grant (base). */
  shared: boolean;
  /** "agent identity" / "knowledge base". */
  noun: string;
  /** How this caller shares it, named exactly, in one clause. */
  remedy: string;
}

/**
 * The one kind probe behind the create and revoke arms. Tests `kind === "link"` positively, never
 * `!isStandardWorkspace` (F-564), so a personal container's private rows pass. A missing row answers
 * `false` — the only fail-open direction, since `withWorkspaceAuth` already proved membership.
 */
export async function isHomeChannelContainer(
  workspaceId: string
): Promise<boolean> {
  const workspace = await findWorkspaceById(workspaceId);
  return workspace?.kind === "link";
}

/** Refuse a row landing private and ungranted in a home channel; a shared row costs no read. */
export async function assertHomeChannelRowIsShared({
  workspaceId,
  shared,
  noun,
  remedy,
}: HomeChannelDestination): Promise<void> {
  if (shared) return;
  if (!(await isHomeChannelContainer(workspaceId))) return;
  throw new HomeChannelRowNotSharedError(
    `A home channel holds only what is shared into it, so this ${noun} was not created. ` +
      `Either share it into the channel (${remedy}), or keep it to yourself in your home space.`
  );
}
