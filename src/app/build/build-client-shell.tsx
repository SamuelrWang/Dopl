"use client";

import { CanvasProvider } from "@/components/canvas/canvas-store";
import { BuilderLayout } from "@/components/builder/builder-layout";
import type { CanvasState } from "@/components/canvas/types";
import type { ServerConversation } from "@/components/canvas/use-conversation-sync";

interface Props {
  userId: string;
  initialState: CanvasState;
  initialConversations: ServerConversation[];
}

export default function BuildClientShell({
  userId,
  initialState,
  initialConversations,
}: Props) {
  return (
    <CanvasProvider
      userId={userId}
      initialState={initialState}
      initialConversations={initialConversations}
    >
      <BuilderLayout />
    </CanvasProvider>
  );
}
