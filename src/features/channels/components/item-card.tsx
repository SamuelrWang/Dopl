import type { ReactNode } from "react";
import { IdentityStack, type IdentityStackFace } from "@/shared/ui/avatar-stack";

/** Faces inline on the meta line before the stack counts the rest. */
const META_FACES = 3;

/**
 * One item of a panel list as its own white card (the Threads and Artifacts lists): the title over
 * one meta line led by the faces, with the actions centred on the right.
 */
export function ItemCard({
  title,
  detail,
  faces,
  facesLabel,
  meta,
  actions,
}: {
  title: string;
  /** An optional line between the title and the meta line. */
  detail?: ReactNode;
  faces: readonly IdentityStackFace[];
  facesLabel?: string;
  meta: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="white-card flex min-w-0 items-center gap-2.5 p-3">
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-body font-medium text-text-primary">{title}</span>
        {detail}
        <span className="flex min-h-5 min-w-0 items-center gap-1.5 text-label text-text-muted">
          <IdentityStack faces={faces} size={20} max={META_FACES} label={facesLabel} />
          {meta}
        </span>
      </span>
      <span className="flex flex-none items-center gap-1.5">{actions}</span>
    </div>
  );
}
