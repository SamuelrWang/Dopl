import type { ReactNode } from "react";

/** One landing section: the 1280px column, eyebrow, heading and its one line. The type is the
 *  landing's own (`.lp-mp-eyebrow`, `.lp-mp-heading`); spacing is devices-landing.css. */
export function Section({
  id,
  eyebrow,
  heading,
  line,
  className,
  children,
}: {
  id: string;
  eyebrow: string;
  heading: string;
  line?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className={`lp-dv-section${className ? ` ${className}` : ""}`}>
      <div className="lp-dv-inner">
        <p className="lp-mp-eyebrow">{eyebrow}</p>
        <h2 id={`${id}-heading`} className="lp-mp-heading">
          {heading}
        </h2>
        {line && <p className="lp-dv-line">{line}</p>}
        {children}
      </div>
    </section>
  );
}

/** A bento card: the landing's `.lp-mp-card`, an optional grey well on top, title and body below. */
export function Tile({ title, body, visual, icon }: { title: string; body: string; visual?: ReactNode; icon?: ReactNode }) {
  return (
    <article className="lp-mp-card lp-dv-tile">
      {visual}
      <div className="lp-mp-copy">
        {icon}
        <h3 className="lp-mp-card-title">{title}</h3>
        <p className="lp-mp-card-body">{body}</p>
      </div>
    </article>
  );
}

/**
 * Code text with the landing window's two colours: whole-line comments (`//`, `#`) in its comment
 * grey, quoted strings in its value blue (`.lp-connect-comment`, `.lp-connect-str`). One `<code>`
 * per line so `white-space: pre` keeps the indentation.
 */
export function CodeLines({ code }: { code: string }) {
  return (
    <>
      {code.split("\n").map((line, i) => {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("#")) {
          return (
            <code key={i} className="lp-connect-comment">
              {line}
            </code>
          );
        }
        const parts = line.split(/("[^"]*"|'[^']*')/);
        return (
          <code key={i} className="lp-connect-cmd">
            {line === ""
              ? " "
              : parts.map((part, j) =>
                  j % 2 === 1 ? (
                    <span key={j} className="lp-connect-str">
                      {part}
                    </span>
                  ) : (
                    part
                  ),
                )}
          </code>
        );
      })}
    </>
  );
}

/** The window's bar: the landing's grey dots, then whatever sits on the right. */
export function WindowBar({ children }: { children: ReactNode }) {
  return (
    <div className="lp-connect-term-bar">
      <span className="lp-connect-dots" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      {children}
    </div>
  );
}
