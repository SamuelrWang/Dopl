/**
 * One active API key per (user, workspace). Thrown by `createWorkspaceKey`
 * when the caller already has a live key for the workspace — the UI must
 * revoke it before generating a new one. Maps to HTTP 409.
 */
export class ActiveKeyExistsError extends Error {
  readonly code = "ACTIVE_KEY_EXISTS";
  constructor() {
    super(
      "An active API key already exists for this workspace. Revoke it before generating a new one."
    );
    this.name = "ActiveKeyExistsError";
  }
}
