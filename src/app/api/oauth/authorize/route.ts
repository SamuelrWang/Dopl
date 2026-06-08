import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/shared/supabase/server";
import { getClient, issueAuthCode } from "@/shared/auth/mcp-oauth";

export const dynamic = "force-dynamic";

/**
 * Consent approval handler for the OAuth authorization endpoint. The consent
 * page (/oauth/authorize) POSTs here. We re-validate the client + redirect_uri
 * (exact match) and the session, then either issue an authorization code and
 * redirect back to the client, or redirect with `error=access_denied`.
 */
function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(request: NextRequest) {
  // CSRF defense for this state-changing, cookie-authenticated POST: reject
  // cross-origin submissions. (Supabase session cookies are SameSite=Lax,
  // which already blocks cross-site cookie POSTs; this is defense-in-depth.)
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Cross-origin request rejected." },
      { status: 403 },
    );
  }

  const user = await getUser();
  const form = await request.formData();

  const clientId = str(form.get("client_id"));
  const redirectUri = str(form.get("redirect_uri"));
  const codeChallenge = str(form.get("code_challenge"));
  const codeChallengeMethod = str(form.get("code_challenge_method")) || "S256";
  const state = str(form.get("state"));
  const decision = str(form.get("decision"));
  const grantWrite = form.get("grant_write") === "on";

  // Re-validate client + redirect before trusting redirectUri for any redirect.
  const client = clientId ? await getClient(clientId) : null;
  if (
    !client ||
    !redirectUri ||
    !client.redirect_uris.includes(redirectUri) ||
    !codeChallenge ||
    codeChallengeMethod !== "S256"
  ) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Invalid authorization request." },
      { status: 400 },
    );
  }

  // Session could have lapsed between page render and submit.
  if (!user) {
    return NextResponse.redirect(
      new URL("/login", request.nextUrl.origin).toString(),
      { status: 303 },
    );
  }

  const target = new URL(redirectUri);
  if (state) target.searchParams.set("state", state);

  if (decision !== "approve") {
    target.searchParams.set("error", "access_denied");
    return NextResponse.redirect(target.toString(), { status: 303 });
  }

  const scopes = grantWrite ? ["dopl.read", "dopl.write"] : ["dopl.read"];
  const code = await issueAuthCode({
    clientId,
    userId: user.id,
    redirectUri,
    codeChallenge,
    scopes,
  });

  target.searchParams.set("code", code);
  return NextResponse.redirect(target.toString(), { status: 303 });
}
