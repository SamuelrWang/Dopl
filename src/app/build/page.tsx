"use client";

import { useEffect, useState } from "react";
import { CanvasProvider } from "@/components/canvas/canvas-store";
import { BuilderLayout } from "@/components/builder/builder-layout";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

export default function BuildPage() {
  const [userId, setUserId] = useState<string | undefined>();
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    getSupabaseBrowser()
      .auth.getUser()
      .then(({ data }: { data: { user: { id: string } | null } }) => {
        if (data.user) setUserId(data.user.id);
      })
      .finally(() => setAuthReady(true));
  }, []);

  if (!authReady) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <div className="animate-pulse text-muted-foreground text-sm">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <CanvasProvider userId={userId}>
      <BuilderLayout />
    </CanvasProvider>
  );
}
