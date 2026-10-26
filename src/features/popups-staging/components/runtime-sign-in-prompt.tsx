// STAGING COPY of apps/desktop-ui/src/components/runtime-sign-in-prompt.tsx (tree of 2026-10-22). Only import paths differ from the source (data hooks,
// desktop libs and unstaged channel bodies → src/features/popups-staging/stubs). See src/features/popups-staging/PORTING.md.
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { toast } from "@/shared/ui/toast";
import { signInFailedCopy } from "@/features/channels/lib/runtime-copy";
import {
  dismissSignInPrompt,
  signInToRuntime,
  useRuntimeCredentials,
} from "@/features/settings-staging/stubs/runtime-signin";

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
