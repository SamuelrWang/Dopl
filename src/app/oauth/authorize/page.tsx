import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { getClient } from "@/shared/auth/mcp-oauth";
import { CrystalShell } from "@/shared/design/crystal-field";

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
 * Server component with a plain HTML form — no client JS required.
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
        <form method="POST" action="/api/oauth/authorize" className="space-y-5">
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

          <p className="text-center text-[14px] leading-relaxed text-[#B4BFCB]">
            <span className="font-semibold text-[#E4EAF1]">{clientLabel}</span>{" "}
            wants to access your Dopl workspaces as{" "}
            <span className="font-medium text-[#E4EAF1]">{user.email}</span>.
          </p>

          <div className="space-y-3 rounded-[8px] border-[1.5px] border-[#33414F] bg-[#1A222E] px-4 py-3.5">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked
                disabled
                aria-label="read access (always granted)"
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#3E5E9E]"
              />
              <p className="text-[13px] leading-relaxed text-[#B4BFCB]">
                <span className="font-mono text-[11px] uppercase tracking-wide text-[#74808C]">
                  read
                </span>{" "}
                Search and read your knowledge bases, skills, and clusters.
              </p>
            </div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="grant_write"
                defaultChecked={requestsWrite}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#3E5E9E]"
              />
              <p className="text-[13px] leading-relaxed text-[#B4BFCB]">
                <span className="font-mono text-[11px] uppercase tracking-wide text-[#74808C]">
                  write
                </span>{" "}
                Create, update, and delete your content — knowledge bases,
                skills, clusters, and canvas.
              </p>
            </label>
          </div>

          <div className="flex gap-2.5 pt-1">
            <button
              type="submit"
              name="decision"
              value="approve"
              className="flex-1 h-11 rounded-[8px] bg-[#3E5E9E] text-[15px] font-semibold text-white hover:bg-[#4A6BAC] transition-colors cursor-pointer"
            >
              Approve
            </button>
            <button
              type="submit"
              name="decision"
              value="deny"
              className="h-11 px-5 rounded-[8px] border-[1.5px] border-[#33414F] bg-transparent text-[15px] font-semibold text-[#B4BFCB] hover:border-[#44566A] hover:text-[#ECF1F6] transition-colors cursor-pointer"
            >
              Deny
            </button>
          </div>
        </form>
      }
    />
  );
}

function Screen({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <CrystalShell>
      <div className="w-full max-w-md">
        {/* Logo + title — outside the card, so they sit over the tiling */}
        <div className="mb-6 flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/favicons/android-chrome-512x512.png"
            alt="Dopl"
            className="h-11 w-11 rounded-[8px]"
          />
          <h1 className="text-[22px] font-semibold leading-tight text-[#ECF1F6]">
            {title}
          </h1>
        </div>
        <div
          data-crystal-panel
          className="rounded-[14px] border border-[#2C3A4E] bg-[#131A24] p-8 shadow-[0_12px_50px_rgba(0,0,0,0.6)]"
        >
          {body}
        </div>
      </div>
    </CrystalShell>
  );
}

function ErrorList({ errors }: { errors: string[] }) {
  return (
    <ul className="space-y-1.5 text-center text-[14px] text-red-300">
      {errors.map((e, i) => (
        <li key={i}>{e}</li>
      ))}
    </ul>
  );
}
