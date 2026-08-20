import { Suspense } from "react";
import { LoginScreen } from "@/features/auth";

/**
 * THE auth page — sign-up and sign-in are ONE page here, switched in place by
 * the form itself (`features/auth/components/login-form.tsx`). `?mode=signup`
 * opens it in sign-up; anything else (including no param) opens sign-in, which
 * keeps every legacy bounce — all of which carried someone who already has an
 * account — landing on the right flow.
 *
 * `/login` and `/signup` both 307 here (their pages are one-line redirects),
 * so this route inherits their obligations: it is PUBLIC + SESSION-AWARE via
 * `shared/auth/auth-routes.ts › AUTH_ENTRY_ROUTES`, it shares the Q4
 * loop-breaker counter with `/login` (see that file's header for why), and it
 * is reserved against workspace slugs in `config/index.ts` ›
 * RESERVED_WORKSPACE_SLUGS and `shared/lib/url/website-retirement.ts` ›
 * RESERVED_TOP_LEVEL.
 */
export default async function AuthenticatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const mode = params.mode === "signup" ? "signup" : "signin";
  return (
    <Suspense>
      <LoginScreen defaultMode={mode} />
    </Suspense>
  );
}
