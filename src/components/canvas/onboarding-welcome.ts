import type { ChatMessage } from "@/components/ingest/chat-message";

/**
 * Pre-populated welcome conversation for first-time users.
 * These messages appear instantly (no API call) and guide the user
 * through Dopl's key features in a conversational tone.
 */
export function createWelcomeMessages(): ChatMessage[] {
  return [
    {
      role: "ai",
      type: "text",
      content: `Hey! Welcome to Dopl 👋

I'm your AI assistant here. Dopl is your workspace for discovering, organizing, and building with AI and automation setups. You can think of it as a knowledge base + builder — paste a link, and I'll break it down into actionable setup guides you can reference anytime.

Let me give you a quick tour of how things work here.`,
    },
    {
      role: "ai",
      type: "text",
      content: `**The Canvas**

This is your canvas — the main workspace. Everything lives here as panels you can drag around and organize:

- **Chat panels** — like this one. Ask me anything, paste URLs to ingest, or get help building.
- **Entry panels** — these appear when you ingest a link. They contain a generated README, setup instructions, and metadata.
- **Clusters** — select multiple panels and group them together. I can see everything in a cluster, so I give better answers when your panels are organized.

Try dragging panels around, zooming in/out, and grouping related ones together.`,
    },
    {
      role: "ai",
      type: "text",
      content: `**Connect Your AI Assistant**

The real power of Dopl is connecting it to your AI coding assistant via MCP. This lets your assistant search your knowledge base, ingest URLs, and build solutions — all from your terminal or editor.

Here's how to set it up:`,
    },
    {
      role: "ai",
      type: "onboarding_card",
      cardType: "mcp_setup",
    },
    {
      role: "ai",
      type: "text",
      content: `**Chrome Extension**

The Dopl Chrome extension lets you ingest pages as you browse — just right-click and send it to your knowledge base. It's especially useful for paywalled or login-gated content that can't be reached by a URL alone.

It only extracts or ingests when you explicitly tell it to — it never reads pages on its own. You also get address bar search and a side panel for quick access.`,
    },
    {
      role: "ai",
      type: "onboarding_card",
      cardType: "chrome_extension",
    },
    {
      role: "ai",
      type: "text",
      content: `That's the quick tour! So — what would you like to build, or is there anything you'd like to explore? You can also just paste a URL to something interesting and I'll break it down for you.

I'm always here if you have questions about anything — just ask anytime.`,
    },
  ];
}
