"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/shared/lib/utils";
import { SMALL_PRIMARY_BUTTON } from "@/shared/ui/small-action-button";
import { Card, ov } from "../../_components/ui";
import { errorText, portalCall } from "../../_lib/client-api";

export type InviteState =
  | { kind: "open" }
  | { kind: "joined"; orgId: string }
  | { kind: "missing" }
  | { kind: "accepted" }
  | { kind: "revoked" }
  | { kind: "expired" }
  | { kind: "mismatch"; invited: string; signedIn: string };

const DEAD: Record<"missing" | "accepted" | "revoked" | "expired", string> = {
  missing: "This invite link is not valid.",
  accepted: "This invite was already used.",
  revoked: "This invite was revoked. Ask for a new one.",
  expired: "This invite has expired. Ask for a new one.",
};

export function AcceptInvite({
  token,
  orgName,
  role,
  state,
}: {
  token: string;
  orgName: string | null;
  role: string | null;
  state: InviteState;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await portalCall<{ orgId: string }>("/api/developers/invites/accept", "POST", { token });
      router.push(`/developers/classic/org?org=${encodeURIComponent(out.orgId)}`);
      router.refresh();
    } catch (e) {
      setError(errorText(e, "Could not accept the invite"));
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-md">
      <Card title={orgName ? `Join ${orgName}` : "Developer invite"}>
        <div className="flex flex-col gap-3">
          {state.kind === "open" && (
            <>
              <p className="text-body text-text-secondary">
                You are invited to {orgName} as {role}.
              </p>
              {error && (
                <p role="alert" className={ov.note} data-tone="over">
                  {error}
                </p>
              )}
              <div>
                <button
                  type="button"
                  className={cn(SMALL_PRIMARY_BUTTON, busy && "opacity-60")}
                  disabled={busy}
                  onClick={() => void accept()}
                >
                  {busy ? "Joining" : "Accept invite"}
                </button>
              </div>
            </>
          )}
          {state.kind === "joined" && (
            <>
              <p className="text-body text-text-secondary">You are already in {orgName}.</p>
              <Link href={`/developers/classic/org?org=${encodeURIComponent(state.orgId)}`} className={SMALL_PRIMARY_BUTTON}>
                Open the org
              </Link>
            </>
          )}
          {state.kind === "mismatch" && (
            <p className="text-body text-text-secondary">
              This invite is for {state.invited}. You are signed in as {state.signedIn}. Sign in with the invited email
              to accept it.
            </p>
          )}
          {(state.kind === "missing" || state.kind === "accepted" || state.kind === "revoked" || state.kind === "expired") && (
            <p className="text-body text-text-secondary">{DEAD[state.kind]}</p>
          )}
        </div>
      </Card>
    </div>
  );
}
