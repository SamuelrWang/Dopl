"use client";

/** Add an endpoint, one decision per page: where, which events, then its signing secret once. */
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { LIVE_WEBHOOK_EVENTS } from "@/features/device-sdk/portal/catalog";
import { portalCall, errorText } from "../../_lib/client-api";
import { Button } from "../_design/ui";
import { DoneFoot, FlowDialog, Tile, Tiles } from "../_design/ui-overlay";
import { Alert, CopyWell, Grow, ProblemAlert, Stack, Text, TextField } from "../_design/ui-page";
import { usePortal } from "../_components/portal-store";

export function AddEndpointFlow({ onClose }: { onClose: () => void }) {
  const { project, env } = usePortal();
  const [step, setStep] = useState(0);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [events, setEvents] = useState<string[]>(["action.completed", "action.failed"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const validUrl = /^https:\/\/\S+\.\S+/.test(url);

  const add = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const made = await portalCall<{ secret: string }>(`/api/developers/projects/${project.id}/webhooks`, "POST", { env, url, description: name.trim(), enabled_events: events });
      setSecret(made.secret);
    } catch (e) {
      setProblem(errorText(e, "Could not add this endpoint."));
    } finally {
      setBusy(false);
    }
  };

  if (secret) {
    return (
      <FlowDialog
        key="secret"
        label="Signing secret"
        eyebrow={name}
        title="Copy your signing secret"
        onDismiss={null}
        foot={<DoneFoot onDone={onClose} />}
      >
        <Stack>
          <CopyWell value={secret} label="Copy secret" />
          <Alert tone="warn" icon={AlertTriangle}>
            Shown once. Store it now.
          </Alert>
        </Stack>
      </FlowDialog>
    );
  }
  return (
    <FlowDialog
      label="Add endpoint"
      eyebrow={`Step ${step + 1} of 2`}
      title={step === 0 ? "Where should events go?" : "Choose events"}
      progress={{ step, of: 2 }}
      onDismiss={onClose}
      foot={
        <>
          {step > 0 && (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          <Grow />
          {step === 0 ? (
            <Button variant="ink" disabled={!validUrl || name.trim() === ""} onClick={() => setStep(1)}>
              Continue
            </Button>
          ) : (
            <Button variant="ink" loading={busy} disabled={events.length === 0} onClick={() => void add()}>
              Add endpoint
            </Button>
          )}
        </>
      }
    >
      {step === 0 ? (
        <Stack>
          <Text kind="strong">Name</Text>
          <TextField autoFocus label="Name" placeholder="Production backend" value={name} onChange={setName} />
          <Text kind="strong">URL</Text>
          <TextField label="URL" placeholder="https://" value={url} onChange={setUrl} />
        </Stack>
      ) : (
        <Stack>
          <Tiles>
            {LIVE_WEBHOOK_EVENTS.map((event) => {
              const on = events.includes(event);
              return (
                <Tile key={event} selected={on} onClick={() => setEvents(on ? events.filter((x) => x !== event) : [...events, event])}>
                  <Text kind="mono" clip>
                    {event}
                  </Text>
                </Tile>
              );
            })}
          </Tiles>
          <ProblemAlert problem={problem} />
        </Stack>
      )}
    </FlowDialog>
  );
}
