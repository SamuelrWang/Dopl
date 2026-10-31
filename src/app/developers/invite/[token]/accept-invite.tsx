"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card } from "../../(portal)/_design/ui";
import { BASE } from "../../(portal)/_components/format";
import { FontScope } from "../../(portal)/_design/font-scope";
import { Page, PageHeader, ProblemAlert, Stack, Text } from "../../(portal)/_design/ui-page";
import { errorText, portalCall } from "../../_lib/client-api";

type InviteState =
  | { kind: "open" }
  | { kind: "joined" }
  | { kind: "missing" }
  | { kind: "accepted" }
  | { kind: "revoked" }
  | { kind: "expired" }
  | { kind: "mismatch"; invited: string; signedIn: string };

const DEAD: Partial<Record<InviteState["kind"], string>> = {
  missing: "This invite link is not valid.",
  accepted: "This invite was already used.",
  revoked: "This invite was revoked. Ask for a new one.",
  expired: "This invite has expired. Ask for a new one.",
};

export function AcceptInvite({ token, orgName, role, state }: { token: string; orgName: string | null; role: string | null; state: InviteState }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dead = DEAD[state.kind];

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await portalCall("/api/developers/invites/accept", "POST", { token });
      router.push(`${BASE}/team`);
      router.refresh();
    } catch (e) {
      setError(errorText(e, "Could not accept the invite"));
      setBusy(false);
    }
  };

  return (
    <FontScope>
      <Page>
        <PageHeader title={orgName ? `Join ${orgName}` : "Developer invite"} />
        <Card>
          <Stack>
            {state.kind === "open" && (
              <>
                <Text>
                  You are invited to {orgName} as {role}.
                </Text>
                <ProblemAlert problem={error} />
                <Button variant="ink" loading={busy} onClick={() => void accept()}>
                  Accept invite
                </Button>
              </>
            )}
            {state.kind === "joined" && (
              <>
                <Text>You are already in {orgName}.</Text>
                <Button variant="ink" href={`${BASE}/team`}>
                  Open the org
                </Button>
              </>
            )}
            {state.kind === "mismatch" && (
              <Text>
                This invite is for {state.invited}. You are signed in as {state.signedIn}. Sign in with the invited email to accept it.
              </Text>
            )}
            {dead && <Text>{dead}</Text>}
          </Stack>
        </Card>
      </Page>
    </FontScope>
  );
}
