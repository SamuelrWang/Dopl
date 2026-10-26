import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { IDENTITY_NAME_TEXT, LABEL_TEXT_MUTED } from "@/shared/ui/section-heading";

/** One reference section: a heading, its one-line rule, then specimens. */
export function SystemSection({
  id,
  title,
  rule,
  children,
}: {
  id: string;
  title: string;
  rule?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex flex-col gap-3 border-t border-border-default pt-6 first:border-t-0 first:pt-0">
      <div>
        <h2 id={`${id}-title`} className={IDENTITY_NAME_TEXT}>
          {title}
        </h2>
        {rule && <p className="mt-0.5 text-caption text-text-muted">{rule}</p>}
      </div>
      {children}
    </section>
  );
}

/** A labelled group of specimens inside a section. */
export function SpecimenRow({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {label && <span className={LABEL_TEXT_MUTED}>{label}</span>}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">{children}</div>
    </div>
  );
}

/** One specimen and its exact name, the string Samuel can point at. */
export function Specimen({
  name,
  children,
  className,
}: {
  name: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <figure className={cn("m-0 flex flex-col items-start gap-1.5", className)}>
      {children}
      <figcaption className="font-mono text-micro text-text-muted">{name}</figcaption>
    </figure>
  );
}
