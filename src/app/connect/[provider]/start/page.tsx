import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolveActiveWorkspace } from "@/features/workspaces/server/service";
import { ProviderSchema } from "@/features/integrations/schema";
import { startBrokerOAuth } from "@/features/integrations/server/service";
import { PROVIDER_DISPLAY_NAMES } from "@/features/integrations/constants";

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
  } catch {
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
