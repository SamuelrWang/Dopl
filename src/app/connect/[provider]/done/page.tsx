import { ProviderSchema } from "@/features/integrations/schema";
import { PROVIDER_DISPLAY_NAMES } from "@/features/integrations/constants";

export const dynamic = "force-dynamic";

type Params = { provider: string };

export default async function ConnectDonePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { provider: rawProvider } = await params;
  const parsed = ProviderSchema.safeParse(rawProvider);
  const name = parsed.success
    ? PROVIDER_DISPLAY_NAMES[parsed.data]
    : "your integration";

  return (
    <main className="min-h-screen flex items-center justify-center text-text-primary px-6">
      <div className="max-w-md w-full rounded-xl bg-white/[0.03] border border-white/[0.08] p-6 text-center space-y-3">
        <h1 className="text-lg font-medium">Connected to {name}</h1>
        <p className="text-sm text-text-secondary">
          You can return to your agent. It can now read from {name} on your
          behalf.
        </p>
      </div>
    </main>
  );
}
