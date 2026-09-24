import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { toast } from "@/shared/ui/toast";
import { signInFailedCopy } from "@/features/channels/lib/runtime-copy";
import {
  dismissSignInPrompt,
  signInToRuntime,
  useRuntimeCredentials,
} from "@/features/channels/components/runtime-signin";

/**
 * The app-level sign-in prompt: main raises it once per runtime when an agent needs that runtime's
 * sign-in, and closes it on a sign-in or a dismissal. One at a time; nothing without the bridge.
 */
export function RuntimeSignInPrompt() {
  const row = useRuntimeCredentials().find((r) => r.prompt);
  if (!row) return null;
  const runtime = { id: row.runtimeId, label: row.label };
  return (
    <ConfirmDialog
      open
      title={`Sign in to ${row.label}`}
      confirmLabel="Sign in"
      cancelLabel="Not now"
      // A sign-in that takes has already closed it in main; a close with it still open is a dismissal.
      onOpenChange={(open) => { if (!open) dismissSignInPrompt(row.runtimeId); }}
      onConfirm={async () => {
        if ((await signInToRuntime(row.runtimeId)).ok) return;
        toast({ title: signInFailedCopy(runtime) });
        throw new Error("sign-in did not take");
      }}
    />
  );
}
