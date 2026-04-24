"use client";

import { CanvasProvider } from "@/features/canvas/canvas-store";
import { BuilderLayout } from "@/components/builder/builder-layout";
import type { CanvasState } from "@/features/canvas/types";
import type { ServerConversation } from "@/features/canvas/use-conversation-sync";

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
