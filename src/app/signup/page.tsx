import { Suspense } from "react";
import { LoginScreen } from "@/features/auth";

/**
 * SIGN UP — the acquisition surface, and the landing page's one call to action
 * (`features/marketing/constants.ts` › GET_STARTED_URL).
 *
 * It renders the SAME screen as `/login` with the other mode: the split is
 * two routes over one form, not two forms. `/login` keeps every bounce
 * destination in the app (middleware, `/auth/callback`, reset-password, the
 * OAuth consent page) because those carry someone who already has an account;
 * nothing redirects HERE, which is why the middleware's `/login` loop breaker
 * stays `/login`-only (see `src/proxy.ts`).
 *
 * `/signup` must also be reserved against workspace slugs — a workspace
 * slugged "signup" would be shadowed by this page. `config/index.ts` ›
 * RESERVED_WORKSPACE_SLUGS carries it, and `shared/lib/url/website-retirement.ts`
 * › RESERVED_TOP_LEVEL keeps the retirement map from reading it as a segment.
 */
export default function SignupPage() {
  return (
    <Suspense>
      <LoginScreen defaultMode="signup" />
    </Suspense>
  );
}
