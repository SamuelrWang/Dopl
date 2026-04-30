"use client";

import { CanvasProvider } from "@/features/canvas/canvas-store";
import { BuilderLayout } from "@/features/builder/components/builder-layout";
import type { CanvasState } from "@/features/canvas/types";
import type { ServerConversation } from "@/features/canvas/use-conversation-sync";

interface Props {
  userId: string;
  canvasId: string;
  canvasSlug: string;
  initialState: CanvasState;
  initialConversations: ServerConversation[];
}

export default function BuildClientShell({
  userId,
  canvasId,
  canvasSlug,
  initialState,
  initialConversations,
}: Props) {
  return (
    <CanvasProvider
      userId={userId}
      canvasId={canvasId}
      canvasSlug={canvasSlug}
      initialState={initialState}
      initialConversations={initialConversations}
    >
      <BuilderLayout />
    </CanvasProvider>
  );
}
