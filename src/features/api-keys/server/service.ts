import "server-only";
import {
  createApiKey,
  findActiveWorkspaceKey,
  revealApiKey,
  revokeApiKey,
} from "@/shared/auth/api-keys";
import { ActiveKeyExistsError } from "./errors";

const DEFAULT_KEY_NAME = "Workspace key";

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "23505"
  );
}

/**
 * Explicit user-initiated create. Enforces one active key per
 * (user, workspace): throws ActiveKeyExistsError (→ 409) when one
 * already exists. Returns the plaintext key (shown ONCE).
 */
export async function createWorkspaceKey(
  userId: string,
  workspaceId: string,
  name: string = DEFAULT_KEY_NAME
): Promise<{ key: string; id: string; name: string; prefix: string }> {
  if (await findActiveWorkspaceKey(userId, workspaceId)) {
    throw new ActiveKeyExistsError();
  }
  try {
    return await createApiKey(name, userId, workspaceId);
  } catch (e) {
    if (isUniqueViolation(e)) throw new ActiveKeyExistsError();
    throw e;
  }
}

/** Reveal the plaintext, gated to the (user, workspace) owner. */
export async function revealWorkspaceKey(
  id: string,
  userId: string,
  workspaceId: string
): Promise<string | null> {
  return revealApiKey(id, { userId, workspaceId });
}

/** Revoke a key, gated to the (user, workspace) owner. */
export async function revokeWorkspaceKey(
  id: string,
  userId: string,
  workspaceId: string
): Promise<void> {
  return revokeApiKey(id, { userId, workspaceId });
}
