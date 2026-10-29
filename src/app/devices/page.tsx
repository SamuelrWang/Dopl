import type { Metadata } from "next";

import { DevicesLanding } from "@/features/marketing/devices-landing/devices-landing";

/**
 * `/devices`: the public Dopl Devices SDK landing page (2026-10-29). Not `/developers`: that path
 * is the signed-in developer portal and the proxy's session gate bounces a signed-out visitor to
 * `/login`, so serving a landing there would need an auth change. Public by
 * `shared/auth/public-routes.ts › PUBLIC_ROUTES`; `devices` is reserved in
 * `config/index.ts › RESERVED_WORKSPACE_SLUGS`.
 */
export const metadata: Metadata = {
  title: "Dopl Devices SDK",
  description: "One SDK to reach your users on every device they wear, carry or live with.",
};

export default function DevicesPage() {
  return <DevicesLanding />;
}
