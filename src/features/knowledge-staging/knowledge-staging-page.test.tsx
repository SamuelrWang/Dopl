// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { KnowledgeStagingPage } from "./knowledge-staging-page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

describe("/knowledge staging", () => {
  it("mounts the product face over the in-memory API and opens a base and a file", async () => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as never;
    Element.prototype.scrollIntoView ??= () => {};
    const network = vi.spyOn(globalThis, "fetch");

    render(<KnowledgeStagingPage />);

    const shared = await screen.findByRole("region", { name: "Shared in this channel" });
    expect(await within(shared).findByText("Platform Runbooks")).toBeTruthy();
    expect(within(shared).queryByText("Postgres 17 Migration")).toBeNull();
    const personal = screen.getByRole("region", { name: "Personal" });
    expect(await within(personal).findByText("Working Notes")).toBeTruthy();

    const card = within(shared).getByText("Platform Runbooks").closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: /open/i }));
    const crumb = await screen.findByLabelText("Knowledge base breadcrumb");
    expect(within(crumb).getByText("Platform Runbooks")).toBeTruthy();

    fireEvent.click(await screen.findByText("Deploys"));
    fireEvent.click(await screen.findByText("Rollback"));
    expect(await screen.findByDisplayValue("Rollback")).toBeTruthy();

    const apiCalls = network.mock.calls.filter(([input]) => String(input).includes("/api/"));
    expect(apiCalls).toEqual([]);
  });
});
