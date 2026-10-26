// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeStagingPage } from "./knowledge-staging-page";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("/knowledge staging on the server", () => {
  it("renders the frame and the face's skeleton without touching window", () => {
    const html = renderToString(<KnowledgeStagingPage />);
    expect(html).toContain("Loading knowledge");
  });
});
