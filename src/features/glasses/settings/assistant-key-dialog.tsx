"use client";

import { CopyButton } from "@/shared/ui/copy-button";
import { FormDialog, FormSection } from "@/shared/ui/form-dialog";
import { useCopyToClipboard } from "@/shared/hooks/use-copy-to-clipboard";
import type { PlatformInfo } from "../platforms/info";
import type { AssistantKey } from "./glasses-api";

/**
 * The one showing of a freshly rotated assistant key. The key lives only in the caller's state;
 * closing drops it, and the server keeps a hash, so there is no second look.
 */
export function AssistantKeyDialog({
  assistant,
  secret,
  onClose,
}: {
  assistant: NonNullable<PlatformInfo["assistant"]>;
  secret: AssistantKey | null;
  onClose: () => void;
}) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <FormDialog
      open={secret !== null}
      onDiscard={onClose}
      title={assistant.name}
      discardLabel="Close"
      primary={{
        label: copied ? "Copied" : "Copy key",
        onClick: () => {
          if (secret) void copy(secret.key);
        },
      }}
    >
      <p className="text-caption text-text-secondary">{assistant.setupPath}</p>
      {secret && (
        <>
          <SecretRow label="URL" text={secret.url} copyLabel="Copy URL" />
          {/* The key's copy is the footer verb; a second one here would be two "Copy key"s. */}
          <SecretRow label="Key" text={secret.key} />
        </>
      )}
    </FormDialog>
  );
}

/** `mcp-connect/components/remote-connect.tsx › Row`'s value box under the kit's label. */
function SecretRow({
  label,
  text,
  copyLabel,
}: {
  label: string;
  text: string;
  copyLabel?: string;
}) {
  return (
    <FormSection label={label}>
      <div className="flex items-center gap-2 rounded-lg border border-border-default bg-bg-elevated px-3 py-2">
        <code className="flex-1 truncate font-mono text-small text-text-secondary">
          {text}
        </code>
        {copyLabel && <CopyButton text={text} label={copyLabel} />}
      </div>
    </FormSection>
  );
}
