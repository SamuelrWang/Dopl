import { DOC_STATUS_LABEL, type DocStatus } from "../content";

/** A page's Live / Beta / Coming soon label, beside the H1. */
export function StatusBadge({ status }: { status: DocStatus }) {
  return (
    <span className="docs-status" data-status={status}>
      {DOC_STATUS_LABEL[status]}
    </span>
  );
}
