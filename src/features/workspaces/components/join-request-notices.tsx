"use client";

import { useRouter } from "next/navigation";
import { JoinRequestNoticesCore } from "./join-request-notices-core";

/**
 * One-time join-request popups for the web app. The markup, the query and the
 * ack live in `./join-request-notices-core`, which leaves navigation to its
 * caller; this file is only the `next/navigation` binding, so the desktop SPA
 * reuses the same notices with its own router.
 */
export function JoinRequestNotices() {
  const router = useRouter();

  return (
    <JoinRequestNoticesCore
      onNavigate={(path) => {
        router.push(path);
        router.refresh();
      }}
    />
  );
}
