import type { ReactNode } from "react";

export type MultiplayerCardProps = {
  /** The faux visual that fills the grey area at the top of the card. */
  visual: ReactNode;
  title: string;
  body: string;
};

/**
 * One Multiplayer benefit card: a light grey visual area filling the top of a
 * white bordered box, then a title and a line or two of muted body under it.
 * Purely presentational — the copy and the visual both come from the section.
 */
export function MultiplayerCard({ visual, title, body }: MultiplayerCardProps) {
  return (
    <article className="lp-mp-card">
      <div className="lp-mp-visual">{visual}</div>
      <div className="lp-mp-copy">
        <h3 className="lp-mp-card-title">{title}</h3>
        <p className="lp-mp-card-body">{body}</p>
      </div>
    </article>
  );
}
