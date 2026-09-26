"use client";

import { useState } from "react";
import { userFacingMessage } from "@/shared/api/user-facing-message";
import { SelectMenu } from "@/shared/ui/select-menu";
import { toast } from "@/shared/ui/toast";
import {
  PAIRING_CODE_LENGTH,
  claimPairing,
  normalizePairingCode,
} from "./glasses-api";
import {
  NO_CHANNEL,
  useGlassesChannelOptions,
  useInvalidateGlassesDevices,
} from "./use-glasses";

/** Label, field and button recipes are the Account pane's (`account-section-core.tsx`). */
export function PairGlasses() {
  const [code, setCode] = useState("");
  const [channelId, setChannelId] = useState(NO_CHANNEL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelOptions = useGlassesChannelOptions();
  const invalidate = useInvalidateGlassesDevices();
  const ready = code.length === PAIRING_CODE_LENGTH && !busy;

  async function pair() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await claimPairing({
        code,
        ...(channelId !== NO_CHANNEL ? { channel_id: channelId } : {}),
      });
      setCode("");
      setChannelId(NO_CHANNEL);
      toast({ title: "Glasses paired" });
      await invalidate();
    } catch (err) {
      setError(userFacingMessage(err, "Couldn't pair"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor="glasses-pair-code"
        className="text-label font-semibold uppercase tracking-wide text-text-muted"
      >
        Pair glasses
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="glasses-pair-code"
          type="text"
          value={code}
          onChange={(e) => {
            setCode(normalizePairingCode(e.target.value));
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            void pair();
          }}
          autoComplete="off"
          spellCheck={false}
          aria-label="Pairing code"
          placeholder="Code"
          className="concave-field w-28 rounded-lg px-2.5 py-1.5 font-mono text-body uppercase tracking-widest text-text-primary outline-none"
        />
        <SelectMenu
          value={channelId}
          options={channelOptions}
          onChange={setChannelId}
          prefix="Channel"
          ariaLabel="Channel for the new glasses"
          disabled={busy}
          menuClassName="max-h-[320px] overflow-y-auto"
        />
        <button
          type="button"
          disabled={!ready}
          onClick={() => void pair()}
          className="flex h-7 cursor-pointer items-center rounded-md bg-surface-cta px-2.5 text-small font-medium text-text-on-cta transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Pairing…" : "Pair"}
        </button>
      </div>
      {error && <p className="text-caption text-danger">{error}</p>}
    </div>
  );
}
