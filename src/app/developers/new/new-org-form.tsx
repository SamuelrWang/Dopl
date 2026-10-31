"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/shared/lib/utils";
import { UnderlineField } from "@/shared/ui/form-dialog";
import { SMALL_PRIMARY_BUTTON } from "@/shared/ui/small-action-button";
import { Card, ov } from "../_components/ui";
import { errorText, portalCall } from "../_lib/client-api";

/** Mirrors `portal-admin.ts › cleanName`'s ceiling. */
const NAME_MAX = 120;

export function NewOrgForm({ firstOrg }: { firstOrg: boolean }) {
  const router = useRouter();
  const [orgName, setOrgName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = orgName.trim().length > 0 && projectName.trim().length > 0;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await portalCall<{ projectId: string }>("/api/developers/orgs", "POST", { orgName, projectName });
      router.push(`/developers/classic/keys?project=${encodeURIComponent(out.projectId)}&env=test`);
      router.refresh();
    } catch (e) {
      setError(errorText(e, "Could not create the org"));
      setBusy(false);
    }
  };

  return (
    <Card title={firstOrg ? "Get started" : "Another org"}>
      <div className="flex max-w-md flex-col gap-4">
        <p className={ov.note}>
          An org holds your projects and your team. Each project gets its own test and live keys, devices and request
          log.
        </p>
        <UnderlineField
          id="org-name"
          label="Org name"
          ariaLabel="Org name"
          placeholder="Your company"
          value={orgName}
          onChange={setOrgName}
          maxLength={NAME_MAX}
          autoFocus
        />
        <UnderlineField
          id="project-name"
          label="First project"
          ariaLabel="First project name"
          placeholder="Your app"
          value={projectName}
          onChange={setProjectName}
          maxLength={NAME_MAX}
          onEnter={() => void submit()}
        />
        {error && (
          <p role="alert" className={ov.note} data-tone="over">
            {error}
          </p>
        )}
        <div>
          <button
            type="button"
            className={cn(SMALL_PRIMARY_BUTTON, !ready && "cursor-not-allowed opacity-60")}
            disabled={!ready || busy}
            onClick={() => void submit()}
            title={ready ? undefined : "Name the org and its first project"}
          >
            {busy ? "Creating" : "Create org"}
          </button>
        </div>
      </div>
    </Card>
  );
}
