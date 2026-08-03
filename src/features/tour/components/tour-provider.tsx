"use client";

import { useRouter } from "next/navigation";
import { TourProviderCore } from "./tour-provider-core";

export { useTour } from "./tour-provider-core";

/**
 * Web binding for the product tour. All the state, persistence and step
 * routing live in `./tour-provider-core`, which takes navigation as a prop;
 * this file is only the `next/navigation` binding, so the desktop SPA reuses
 * the same provider with its own router (the wave-1 core/binding pattern).
 */
export function TourProvider({
  workspaceSegment,
  children,
}: {
  workspaceSegment: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <TourProviderCore
      workspaceSegment={workspaceSegment}
      onNavigate={(path) => router.push(path)}
    >
      {children}
    </TourProviderCore>
  );
}
