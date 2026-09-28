"use client";

/**
 * "Connect an agent": the hosted MCP endpoint and, per client, the one thing to paste. No API
 * key — the client runs the OAuth sign-in on first connect. Origin is read client-side to match
 * the live deployment.
 */

import { useEffect, useState } from "react";
import { CopyButton } from "@/shared/ui/copy-button";
import { connectRecipes } from "../snippets";
import { getAppOrigin } from "@/shared/lib/app-origin";

export function RemoteConnect() {
  const [origin, setOrigin] = useState("https://www.usedopl.com");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(getAppOrigin());
  }, []);

  return (
    <ul aria-label="Connect an agent" className="divide-y divide-border-subtle">
      {connectRecipes(`${origin}/api/mcp`).map((recipe) => (
        <li key={recipe.client} className="flex min-w-0 items-center gap-3 py-2.5">
          <div className="w-36 shrink-0">
            <p className="truncate text-body font-medium text-text-primary">{recipe.client}</p>
            <p className="truncate text-caption text-text-muted">{recipe.hint}</p>
          </div>
          <code className="min-w-0 flex-1 truncate font-mono text-small text-text-secondary">
            {recipe.text}
          </code>
          <CopyButton text={recipe.text} label={`Copy for ${recipe.client}`} />
        </li>
      ))}
    </ul>
  );
}
