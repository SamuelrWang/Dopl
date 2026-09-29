/**
 * `withUserAuth({ sessionOnly })` for the routes that mint or change device
 * credentials (claim, rename, revoke, assistant key): a signed-in PERSON
 * only, so a prompt-injected agent holding a `dopl_at_` token cannot mint a
 * long-lived glasses credential. The one escape is local dev's
 * `GLASSES_DEV_AGENT_TOKENS=1` outside production, for `scripts/glasses-dev-seed.mjs`.
 */
export function glassesSessionOnly(env: Record<string, string | undefined> = process.env): boolean {
  return !(env.NODE_ENV !== "production" && env.GLASSES_DEV_AGENT_TOKENS === "1");
}
