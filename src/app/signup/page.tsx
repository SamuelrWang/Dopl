import { Suspense } from "react";
import { LoginScreen } from "@/features/auth";

/**
 * SIGN UP — the acquisition surface and the landing page's one CTA
 * (`features/marketing/constants.ts` › GET_STARTED_URL). Renders the SAME screen as `/login` in
 * the other mode: two routes over one form.
 * ⚠ Nothing redirects HERE — every bounce destination stays `/login`, which is why the
 * middleware's loop breaker is `/login`-only (`src/proxy.ts`).
 * ⚠ Must stay reserved against workspace slugs, or a workspace slugged "signup" is shadowed:
 * `config/index.ts` › RESERVED_WORKSPACE_SLUGS and `shared/lib/url/website-retirement.ts` ›
 * RESERVED_TOP_LEVEL.
 */
export default function SignupPage() {
  return (
    <Suspense>
      <LoginScreen defaultMode="signup" />
    </Suspense>
  );
}
