import { ProviderSchema } from "@/features/integrations/schema";
import { PROVIDER_DISPLAY_NAMES } from "@/features/integrations/constants";

export const dynamic = "force-dynamic";

type Params = { provider: string };

const REASON_COPY: Record<string, string> = {
  unknown_provider: "We don't support this integration yet.",
  missing_params: "The connection link was incomplete.",
  initiate_failed:
    "We couldn't start the connection. Please try again in a moment.",
  finalize_failed:
    "The provider returned, but we couldn't finalize the connection.",
};

export default async function ConnectErrorPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ reason?: string }>;
}) {
  const { provider: rawProvider } = await params;
  const { reason } = await searchParams;
  const parsed = ProviderSchema.safeParse(rawProvider);
  const name = parsed.success
    ? PROVIDER_DISPLAY_NAMES[parsed.data]
    : "the integration";

  const message =
    (reason && REASON_COPY[reason]) ??
    "Something went wrong while connecting.";

  return (
    <main className="min-h-screen flex items-center justify-center text-text-primary px-6">
      <div className="max-w-md w-full rounded-xl bg-white/[0.03] border border-white/[0.08] p-6 text-center space-y-3">
        <h1 className="text-lg font-medium">Couldn&apos;t connect {name}</h1>
        <p className="text-sm text-text-secondary">{message}</p>
        <p className="text-xs text-text-tertiary">
          Tell your agent to retry — it will surface the next steps.
        </p>
      </div>
    </main>
  );
}
