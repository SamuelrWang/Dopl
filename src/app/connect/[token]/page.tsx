/**
 * /connect/[token] — the Device SDK hosted Connect page (C2, A4). Opened by a developer's END USER,
 * who has no Dopl account (D1): no session is read, the token in the URL is the credential, and
 * `/connect/` is in `PUBLIC_ROUTES`. White-label: the developer's branding snapshot, minimal chrome
 * (labels and controls only — Samuel's minimal-UI-copy ruling).
 *
 * An unknown token 404s (not an oracle for which tokens exist); an expired one says so.
 */
import { notFound } from "next/navigation";
import { connectPageView } from "@/features/device-sdk/server/connect/hosted";
import { connectDeps } from "@/features/device-sdk/server/connect/runtime";
import { ConnectFlow } from "./connect-flow";

export const dynamic = "force-dynamic";

export const metadata = { robots: { index: false, follow: false } };

export default async function ConnectPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = token ? await connectPageView(connectDeps, token) : null;
  if (!view) notFound();
  return (
    // Fixed full-viewport white surface, the `/link/[token]` pattern: the shell paints the dark
    // frame on <body> for non-workspace roots.
    <main className="fixed inset-0 z-50 overflow-y-auto bg-white">
      <div className="flex min-h-full items-center justify-center px-5 py-16">
        <ConnectFlow token={token} view={view} />
      </div>
    </main>
  );
}
