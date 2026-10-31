"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card } from "../(portal)/_design/ui";
import { LabeledField } from "../(portal)/_design/ui-output";
import { Page, PageHeader, ProblemAlert, Stack, TextField } from "../(portal)/_design/ui-page";
import { FontScope } from "../(portal)/_design/font-scope";
import { BASE, PROJECT_COOKIE, writePortalCookie } from "../(portal)/_components/format";
import { errorText, portalCall } from "../_lib/client-api";

export function NewOrgForm() {
  const router = useRouter();
  const [orgName, setOrgName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = orgName.trim() !== "" && projectName.trim() !== "";

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await portalCall<{ projectId: string }>("/api/developers/orgs", "POST", { orgName: orgName.trim(), projectName: projectName.trim() });
      writePortalCookie(PROJECT_COOKIE, out.projectId);
      router.push(`${BASE}/keys`);
      router.refresh();
    } catch (e) {
      setError(errorText(e, "Could not create this org."));
      setBusy(false);
    }
  };

  return (
    <FontScope>
      <Page>
        <PageHeader title="Create a developer org" />
        <Card>
          <Stack>
            <LabeledField label="Org name">
              <TextField autoFocus label="Org name" placeholder="Your company" value={orgName} onChange={setOrgName} />
            </LabeledField>
            <LabeledField label="First project">
              <TextField label="First project" placeholder="Your app" value={projectName} onChange={setProjectName} onEnter={() => void submit()} />
            </LabeledField>
            <ProblemAlert problem={error} />
            <Button variant="ink" loading={busy} disabled={!ready} onClick={() => void submit()}>
              Create org
            </Button>
          </Stack>
        </Card>
      </Page>
    </FontScope>
  );
}
