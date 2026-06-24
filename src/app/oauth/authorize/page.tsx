import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { getClient } from "@/shared/auth/mcp-oauth";
import { AuthSplitLayout } from "@/shared/layout/auth-split";

export const dynamic = "force-dynamic";

/**
 * OAuth 2.1 authorization endpoint (consent screen) for the remote MCP
 * server. MCP clients redirect the user's browser here after discovery +
 * dynamic client registration. Flow:
 *   1. Validate client_id / redirect_uri (exact match) / response_type / PKCE.
 *      Invalid client or redirect ⇒ render an error (never redirect to an
 *      unverified URI).
 *   2. Require a logged-in Dopl user — bounce through /login and return here.
 *   3. Render a consent form. Approve POSTs to /api/oauth/authorize, which
 *      issues the authorization code and redirects back to the client.
 *
 * Shares the light split layout with /login + onboarding (left form column,
 * right crystal panel). Server component with a plain HTML form — no client
 * JS required.
 */

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const responseType = first(sp.response_type);
  const clientId = first(sp.client_id);
  const redirectUri = first(sp.redirect_uri);
  const codeChallenge = first(sp.code_challenge);
  const codeChallengeMethod = first(sp.code_challenge_method) || "S256";
  const scope = first(sp.scope);
  const state = first(sp.state);

  const errors: string[] = [];
  if (responseType !== "code") errors.push("response_type must be 'code'.");
  if (!clientId) errors.push("client_id is required.");
  if (!redirectUri) errors.push("redirect_uri is required.");
  if (!codeChallenge) errors.push("code_challenge (PKCE) is required.");
  if (codeChallengeMethod !== "S256")
    errors.push("Only the S256 PKCE method is supported.");

  const client = clientId ? await getClient(clientId) : null;
  if (clientId && !client) errors.push("Unknown client_id.");
  if (client && redirectUri && !client.redirect_uris.includes(redirectUri)) {
    errors.push("redirect_uri does not match a registered URI for this client.");
  }

  if (errors.length > 0) {
    return <Screen title="Authorization error" body={<ErrorList errors={errors} />} />;
  }

  // Require a logged-in user; bounce through login and return to this exact URL.
  const user = await getUser();
  if (!user) {
    const qs = new URLSearchParams({
      response_type: responseType,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      ...(scope ? { scope } : {}),
      ...(state ? { state } : {}),
    });
    redirect(`/login?redirectTo=${encodeURIComponent(`/oauth/authorize?${qs.toString()}`)}`);
  }

  // Offer write access when the client requested it, or when it requested no
  // specific scope (default full). Read is always granted.
  const requestsWrite =
    scope.trim() === "" || scope.split(/\s+/).includes("dopl.write");
  const clientLabel = client?.client_name || "An MCP client";

  return (
    <Screen
      title="Connect to Dopl"
      body={
        <form method="POST" action="/api/oauth/authorize">
          <input type="hidden" name="response_type" value={responseType} />
          <input type="hidden" name="client_id" value={clientId} />
          <input type="hidden" name="redirect_uri" value={redirectUri} />
          <input type="hidden" name="code_challenge" value={codeChallenge} />
          <input
            type="hidden"
            name="code_challenge_method"
            value={codeChallengeMethod}
          />
          <input type="hidden" name="scope" value={scope} />
          <input type="hidden" name="state" value={state} />

          <p className="text-[14px] leading-relaxed text-[#5a5a5a]">
            <span className="font-semibold text-[#181818]">{clientLabel}</span>{" "}
            wants to access your Dopl workspaces as{" "}
            <span className="font-medium text-[#181818]">{user.email}</span>.
          </p>

          <div className="auth-field-3d mt-6 space-y-3.5 rounded-[10px] px-[16px] py-4">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked
                disabled
                aria-label="read access (always granted)"
                className="mt-0.5 h-[18px] w-[18px] shrink-0 rounded-[4px] accent-[#181818]"
              />
              <p className="text-[13px] leading-relaxed text-[#5a5a5a]">
                <span className="mr-1 font-mono text-[11px] uppercase tracking-wide text-[#9a9a9a]">
                  read
                </span>
                Search and read your knowledge bases, skills, and clusters.
              </p>
            </div>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                name="grant_write"
                defaultChecked={requestsWrite}
                className="mt-0.5 h-[18px] w-[18px] shrink-0 rounded-[4px] accent-[#181818]"
              />
              <p className="text-[13px] leading-relaxed text-[#5a5a5a]">
                <span className="mr-1 font-mono text-[11px] uppercase tracking-wide text-[#9a9a9a]">
                  write
                </span>
                Create, update, and delete your content — knowledge bases,
                skills, clusters, and canvas.
              </p>
            </label>
          </div>

          <div className="mt-7 flex gap-3">
            <button
              type="submit"
              name="decision"
              value="approve"
              className="auth-btn-3d flex h-[46px] flex-1 cursor-pointer items-center justify-center rounded-[10px] text-[15px] font-semibold text-white"
            >
              Approve
            </button>
            <button
              type="submit"
              name="decision"
              value="deny"
              className="auth-btn-3d-light h-[46px] cursor-pointer rounded-[10px] px-6 text-[15px] font-semibold text-[#181818]"
            >
              Deny
            </button>
          </div>
        </form>
      }
    />
  );
}

/** Light split surface shared with /login: brand + title in the left column,
 *  crystal panel on the right (collapses on mobile). */
function Screen({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <AuthSplitLayout>
      <div
        className="w-full max-w-[336px]"
        style={{ animation: "loginFadeIn 0.6s ease-out both" }}
      >
        {/* Brand: logo mark above wordmark — same as /login */}
        <div className="flex flex-col items-start gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/favicons/android-chrome-512x512.png"
            alt="Dopl"
            className="auth-logo-3d h-8 w-8 rounded-[6px]"
          />
          <span
            className="text-[21px] font-medium text-[#181818]"
            style={{ fontFamily: "var(--font-playfair), Georgia, serif", fontStyle: "italic" }}
          >
            Dopl
          </span>
        </div>

        <h2 className="mt-7 text-[30px] font-bold leading-tight tracking-[-0.8px] text-[#181818]">
          {title}
        </h2>

        <div className="mt-7">{body}</div>
      </div>
    </AuthSplitLayout>
  );
}

function ErrorList({ errors }: { errors: string[] }) {
  return (
    <ul className="space-y-1.5 text-[14px] text-red-600">
      {errors.map((e, i) => (
        <li key={i}>{e}</li>
      ))}
    </ul>
  );
}
