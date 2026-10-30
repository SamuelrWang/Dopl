import Image from "next/image";
import type { ReactNode } from "react";
import ada from "./avatar-ada.png";
import agus from "./avatar-agus.png";
import terus from "./avatar-terus.png";
import b from "./base.module.css";

export function cx(...names: (string | false | undefined)[]) {
  return names.filter(Boolean).join(" ");
}

export function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className={b.section}>
      <h2 className={b.sectionLabel}>{label}</h2>
      {children}
    </section>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx(b.card, className)}>{children}</div>;
}

const FACES = { ada, terus, agus };

/** The three crops from the reference. Only they are photos; everyone else gets initials. */
export function Face({ who, small, clip }: { who: keyof typeof FACES; small?: boolean; clip?: boolean }) {
  return (
    <span className={cx(b.face, small && b.faceSm)}>
      <Image className={cx(b.faceImg, clip && b.faceClip)} src={FACES[who]} alt="" width={50} height={50} unoptimized />
    </span>
  );
}

export function Initials({ text, small, ink }: { text: string; small?: boolean; ink?: boolean }) {
  return <span className={cx(b.initials, small && b.initialsSm, ink && b.initialsInk)}>{text}</span>;
}

export const ICON = { size: 20, strokeWidth: 1.6 } as const;
export const ICON_SM = { size: 17.5, strokeWidth: 1.6 } as const;
/** The same icons at true size, for real pages on .u100. */
export const ICON_100 = { size: 16, strokeWidth: 1.5 } as const;
export const ICON_100_SM = { size: 14, strokeWidth: 1.5 } as const;

export const initialsOf = (name: string) =>
  name
    .split(/[\s-]+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
