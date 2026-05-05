import { ProviderSchema } from "@/features/integrations/schema";
import { PROVIDER_DISPLAY_NAMES } from "@/features/integrations/constants";
import { PopupClose } from "@/features/integrations/components/popup-close";

export const dynamic = "force-dynamic";

type Params = { provider: string };

export default async function PopupSuccessPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { provider: rawProvider } = await params;
  const parsed = ProviderSchema.safeParse(rawProvider);
  const name = parsed.success
    ? PROVIDER_DISPLAY_NAMES[parsed.data]
    : "your integration";
  const provider = parsed.success ? parsed.data : null;

  return (
    <main className="min-h-screen flex items-center justify-center text-text-primary px-6 bg-black">
      <div className="max-w-sm w-full rounded-xl bg-white/[0.03] border border-white/[0.08] p-6 text-center space-y-3">
        <h1 className="text-lg font-medium">Connected to {name}</h1>
        <p className="text-sm text-text-secondary">
          You can close this window.
        </p>
        <PopupClose status="ok" provider={provider} />
      </div>
    </main>
  );
}
