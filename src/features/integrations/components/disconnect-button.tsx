"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Props {
  provider: string;
  workspaceId: string;
  providerLabel: string;
}

export function DisconnectButton({ provider, workspaceId, providerLabel }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (
      !window.confirm(
        `Disconnect ${providerLabel}? Your existing entries stay; you'll need to reconnect to pull anything new.`
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await fetch(
        `/api/integrations/${encodeURIComponent(provider)}/disconnect`,
        { method: "POST", headers: { "x-workspace-id": workspaceId } }
      );
      if (!res.ok) {
        setError(`Disconnect failed (${res.status}). Try again.`);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-1.5 text-xs text-white/70 hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
      >
        {isPending ? "Disconnecting…" : "Disconnect"}
      </button>
      {error ? <p className="text-[10px] text-red-400">{error}</p> : null}
    </div>
  );
}
