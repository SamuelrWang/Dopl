import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { getClient } from "@/shared/auth/mcp-oauth";

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

          <p className="text-[13px] leading-relaxed text-text-secondary">
            <span className="text-text-primary font-medium">{clientLabel}</span> wants
            to access your Dopl workspaces as{" "}
            <span className="text-text-primary">{user.email}</span>.
          </p>

          <div className="space-y-2 text-[12px] text-text-tertiary">
            <div className="flex items-start gap-2">
              <span className="text-text-muted font-mono">read</span>
              <span>Search and read your setups, clusters, knowledge bases, and skills.</span>
            </div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                name="grant_write"
                defaultChecked={requestsWrite}
                className="mt-0.5"
              />
              <span>
                <span className="text-text-muted font-mono">write</span>{" "}
                Create, update, and delete your content (canvas, clusters,
                knowledge bases, skills, ingestion).
              </span>
            </label>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              name="decision"
              value="approve"
              className="flex-1 h-9 rounded-[4px] bg-surface-raised-4 border border-border-highlight text-text-primary text-[12px] font-mono uppercase tracking-wider hover:bg-surface-selected transition-colors"
            >
              Approve
            </button>
            <button
              type="submit"
              name="decision"
              value="deny"
              className="h-9 px-4 rounded-[4px] border border-border-strong text-text-tertiary text-[12px] font-mono uppercase tracking-wider hover:text-text-primary hover:border-border-highlight transition-colors"
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
    <div className="fixed inset-0 flex items-center justify-center bg-black px-6">
      <div className="w-full max-w-sm rounded-[8px] border border-border-default bg-[var(--card-surface-elevated)] p-6">
        <h1
          className="text-2xl font-bold mb-5"
          style={{
            fontFamily: "var(--font-playfair), 'Playfair Display', serif",
            fontStyle: "italic",
            color: "white",
          }}
        >
          Dopl
        </h1>
        <h2 className="text-[13px] font-mono uppercase tracking-wider text-text-secondary mb-4">
          {title}
        </h2>
        {body}
      </div>
    </div>
  );
}

function ErrorList({ errors }: { errors: string[] }) {
  return (
    <ul className="space-y-1.5 text-[12px] text-[color:var(--coral)]">
      {errors.map((e, i) => (
        <li key={i}>• {e}</li>
      ))}
    </ul>
  );
}
