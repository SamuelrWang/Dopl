"use client";

import { Section } from "../_design/components";
import { Badge, Card } from "../_design/ui";
import { Callout, CodeTabs, DocEndpoint, DocFacts, DocFlow, DocHead, DocLog, DocSteps, DocTable, Inline, ParamRow, Prose } from "../_design/ui-docs";
import { TableHead, Text } from "../_design/ui-page";

/** What a documentation page is built from. */
export function DocsGroup() {
  return (
    <Section label="Docs">
      <DocHead group="Guides" title="Deliver a message" badge={<Badge tone="ok" dot>Live</Badge>}>
        Send text to a user on their best device.
      </DocHead>
      <Prose>
        <h2>Send it</h2>
        <p>
          Call <code>notify</code> with the user&apos;s id. <strong>Test keys</strong> reach simulated devices, as <a href="#docs">test mode</a> explains.
        </p>
        <ul>
          <li>One call per user</li>
          <li>Retried for ten minutes</li>
        </ul>
      </Prose>
      <Callout>
        Keep the secret key on your <code>server</code>.
      </Callout>
      <CodeTabs tabs={[{ label: "TypeScript", code: 'await dopl.notify("usr_123", {\n  text: "Your build finished",\n});' }, { label: "cURL", code: "curl https://api.usedopl.com/v1/users/usr_123/deliver" }]} />
      <DocEndpoint id="gallery-endpoint" method={<Badge tone="ink">POST</Badge>} path="/v1/users/{id}/deliver" />
      <Card flush>
        <TableHead>
          <Text kind="h3">Body</Text>
        </TableHead>
        <ParamRow name="text" badges={<><Badge tone="ink">required</Badge><Badge tone="ring">string</Badge></>}>
          What to show. <code>280</code> characters at most.
        </ParamRow>
      </Card>
      <Card flush>
        <DocTable columns={["Intent", "Goes to"]} rows={[[<Inline key="a"><code>notify</code></Inline>, <Inline key="b">The first device that can show text</Inline>]]} />
      </Card>
      <DocSteps items={[{ title: "Get a key", body: <Inline>From the portal.</Inline> }, { title: "Send", body: <Inline>From your server.</Inline> }]} />
      <DocFlow label="How it works" items={[{ title: "Your agent", detail: "Calls the API" }, { title: "Dopl", detail: "Picks the device" }, { title: "Device", detail: "Shows it" }]} />
      <DocFacts rows={[["Limits", <Inline key="l">600 a minute</Inline>], ["Permission", <Inline key="p">Granted at connect</Inline>]]} />
      <DocLog entries={[{ id: "gallery-log", date: "October 27", title: "Device SDK", body: "First release." }]} />
    </Section>
  );
}
