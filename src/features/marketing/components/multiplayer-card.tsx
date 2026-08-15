import type { ReactNode } from "react";

export type MultiplayerCardProps = {
  visual: ReactNode;
  title: string;
  body: string;
};

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
