import { redirect } from "next/navigation";
import { forwardQuery } from "../forward-query";

/**
 * REDIRECTOR, not a screen — the form lives at `/authenticate` (one page, both
 * flows), and this path forwards with `mode=signup` so it still opens in
 * sign-up. Kept because the landing page shipped `/signup` CTAs for months and
 * external links exist.
 *
 * ⚠ Nothing redirects HERE — every bounce destination stays `/login` — which is
 * why this path is NOT on the Q4 breaker's counted list.
 * ⚠ Must stay reserved against workspace slugs (`config/index.ts` ›
 * RESERVED_WORKSPACE_SLUGS, `shared/lib/url/website-retirement.ts` ›
 * RESERVED_TOP_LEVEL) or a workspace slugged "signup" is shadowed.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = forwardQuery(await searchParams);
  query.set("mode", "signup");
  redirect(`/authenticate?${query.toString()}`);
}
