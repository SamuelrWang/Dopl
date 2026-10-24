"use client";

/**
 * **THE AGENT VIEW'S "MESSAGE RECEIVED FROM" AND "POSTED TO" BOXES, REDESIGNED FOR THE
 * BANNER DEMO ONLY** (Samuel, 2026-10-22).
 *
 * ⚠ **THE PRODUCT BOXES ARE UNTOUCHED.** `channels/components/agent-stream-inbound-box.tsx
 * › InboundBox` and `agent-stream-sent-box.tsx › SentToChannelBox` still render inside the
 * real `AgentStream`; {@link DemoStreamBoxes} hides each one and portals this face after it
 * (`demo-swap.ts`).
 *
 * ⚠ **THE FACTS ARE READ OFF THE PRODUCT BOX, NOT RESTATED.** Its label, stamp, addressee
 * pills and paint are read from its DOM, and its rendered body (markdown, mention pills) is
 * CLONED in, so the demo face cannot say anything the product box does not. Only the face
 * changes: a white message card with a small header row ("Received from @x · time",
 * "Posted to … · time") and the author's colour as the card's whole border line, where
 * the product draws a filled banner.
 */

import { useLayoutEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { PairedAvatar } from "@/features/onboarding/components/paired-avatar";
import { colorSlot, useDemoSwap } from "./demo-swap";

/** Who a box is from, by the `@handle` its label names (`"you"` = the operator). */
export type StreamFace = { photo: string | null; color: string | null; logo?: string };

const VIEW = 'aside[aria-label="Agent view"]';
const INBOUND = "[data-stream-inbound]";
/** `SentToChannelBox`'s root; `artifact-card.tsx` shares the classes but never renders here. */
const SENT = "div.border-border-active.bg-card-surface-subtle";

type BoxFacts = {
  kind: "inbound" | "sent";
  label: string;
  stamp: string;
  tags: string[];
  /** The product's paint, a `var(--…)` or `null` for the neutral face. */
  paint: string | null;
  human: boolean;
};

function factsOf(source: HTMLElement, kind: BoxFacts["kind"]): BoxFacts {
  const banner = source.firstElementChild as HTMLElement | null;
  const label = banner?.firstElementChild?.textContent?.trim() ?? "";
  const stamp = banner?.querySelector(".ml-auto")?.textContent?.trim() ?? "";
  const tags = [...(banner?.querySelectorAll("[data-recipient-tag]") ?? [])].map(
    (t) => t.textContent?.trim() ?? ""
  );
  const fill = banner?.style.backgroundColor || "";
  const human = source.getAttribute("data-stream-inbound-paint") === "human";
  return {
    kind,
    label:
      kind === "inbound" ? label.replace(/^Message received/, "Received") : label,
    stamp,
    tags,
    paint: fill && !human ? fill : null,
    human,
  };
}

function Body({ source, sig }: { source: HTMLElement; sig: string }) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = slot.current;
    if (!el) return;
    el.replaceChildren(
      ...[...source.children].slice(1).map((c) => c.cloneNode(true))
    );
  }, [source, sig]);
  return <div ref={slot} className="lp-demo-sb-body" />;
}

export function DemoStreamBox({
  source,
  sig,
  facts,
  face,
}: {
  source: HTMLElement;
  sig: string;
  facts: BoxFacts;
  face: StreamFace | null;
}) {
  const accent = facts.human ? "var(--surface-cta)" : facts.paint;
  return (
    <div
      className="lp-demo-sb"
      data-kind={facts.kind}
      style={accent ? { ["--lp-sb-accent" as string]: accent } : undefined}
    >
      <div className="lp-demo-sb-head">
        {face?.photo &&
          (face.color && face.logo ? (
            <PairedAvatar
              d={18}
              thinFrame
              photo={face.photo}
              agentLogo={face.logo}
              color={colorSlot(face.color)}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- tiny decorative avatar
            <img src={face.photo} alt="" className="lp-demo-sb-person" draggable={false} />
          ))}
        <span className="lp-demo-sb-label">{facts.label}</span>
        {facts.tags.map((tag) => (
          <span key={tag} className="lp-demo-sb-tag">
            {tag}
          </span>
        ))}
        {facts.stamp && <span className="lp-demo-sb-stamp">· {facts.stamp}</span>}
      </div>
      <Body source={source} sig={sig} />
    </div>
  );
}

export function DemoStreamBoxes({
  paneRef,
  faces,
  self,
}: {
  paneRef?: RefObject<HTMLDivElement | null>;
  /** `@handle` → that agent's owner photo and colour key; `"you"` → the operator. */
  faces: ReadonlyMap<string, StreamFace>;
  /** The open agent's own face, for what it posted. */
  self: StreamFace;
}) {
  const swaps = useDemoSwap(
    paneRef,
    (pane) => {
      const view = pane.querySelector(VIEW);
      if (!view) return [];
      const inbound = [...view.querySelectorAll<HTMLElement>(INBOUND)].map(
        (source, i) => ({ key: `inbound-${i}`, source })
      );
      const sent = [...view.querySelectorAll<HTMLElement>(SENT)]
        .filter((el) => !el.matches(INBOUND))
        .map((source, i) => ({ key: `sent-${i}`, source }));
      return [...inbound, ...sent];
    },
    "lp-demo-sb-host"
  );

  return (
    <>
      {swaps.map(({ key, source, host, sig }) => {
        const facts = factsOf(source, key.startsWith("sent") ? "sent" : "inbound");
        let face: StreamFace | null = self;
        if (facts.kind === "inbound") {
          const handle = /@([\w-]+)/.exec(facts.label)?.[1];
          face = facts.label.endsWith("from you")
            ? (faces.get("you") ?? null)
            : handle
              ? (faces.get(handle) ?? null)
              : null;
        }
        return createPortal(
          <DemoStreamBox source={source} sig={sig} facts={facts} face={face} />,
          host,
          key
        );
      })}
    </>
  );
}
