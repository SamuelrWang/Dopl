import { redirect } from "next/navigation";
import { forwardQuery } from "../forward-query";

/**
 * REDIRECTOR, not a screen — the form lives at `/authenticate` (one page, both
 * flows). This path stays because it is the DEFAULT bounce destination for
 * every unauthenticated caller (middleware, `/auth/callback`, reset-password,
 * the OAuth consent screen) — those all carry someone who already has an
 * account, and `/authenticate` opens in sign-in by default, so no `mode` is
 * added.
 *
 * ⚠ A signed-in visitor never reaches this redirect — the middleware bounces
 * them into the app first, counting the hop on the Q4 breaker
 * (`shared/auth/auth-routes.ts › LOOP_COUNTED_AUTH_ROUTES`).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const qs = forwardQuery(await searchParams).toString();
  redirect(`/authenticate${qs ? `?${qs}` : ""}`);
}
