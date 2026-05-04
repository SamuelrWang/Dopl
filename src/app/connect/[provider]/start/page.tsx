import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolveActiveWorkspace } from "@/features/workspaces/server/service";
import { ProviderSchema } from "@/features/integrations/schema";
import { startBrokerOAuth } from "@/features/integrations/server/service";
import { PROVIDER_DISPLAY_NAMES } from "@/features/integrations/constants";
import { logSystemEvent } from "@/features/analytics/server/system-events";

export const dynamic = "force-dynamic";

type Params = { provider: string };

export default async function ConnectStartPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { provider: rawProvider } = await params;
  const parsed = ProviderSchema.safeParse(rawProvider);
  if (!parsed.success) redirect(`/connect/unknown/error?reason=unknown_provider`);
  const provider = parsed.data;

  const user = await getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/connect/${provider}/start`)}`);
  }

  const { workspace } = await resolveActiveWorkspace(user.id, null);

  let result: Awaited<ReturnType<typeof startBrokerOAuth>>;
  try {
    result = await startBrokerOAuth({
      workspaceId: workspace.id,
      userId: user.id,
      provider,
    });
  } catch (err) {
    // Re-throw `redirect()`'s internal NEXT_REDIRECT signal so Next can
    // process it instead of treating it like an integration failure.
    if (err && typeof err === "object" && "digest" in err) throw err;
    const message = err instanceof Error ? err.message : String(err);
    void logSystemEvent({
      severity: "error",
      category: "other",
      source: "GET /connect/[provider]/start",
      message: `Initiate failed: ${message}`,
      fingerprintKeys: ["integrations_initiate_failed", provider],
      metadata: { provider, error: message },
      userId: user.id,
    });
    redirect(`/connect/${provider}/error?reason=initiate_failed`);
  }

  if (result.status === "connected") {
    redirect(`/connect/${provider}/done`);
  }
  redirect(result.brokerAuthUrl);

  return (
    <main className="min-h-screen flex items-center justify-center text-text-primary">
      <p className="text-sm text-text-secondary">
        Connecting to {PROVIDER_DISPLAY_NAMES[provider]}…
      </p>
    </main>
  );
}
