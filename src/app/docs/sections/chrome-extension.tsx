import { H2, P, Code, Table, SectionHero, type TocEntry } from "../docs-primitives";

export const TOC: TocEntry[] = [
  { id: "extension-install", title: "Installation", level: 2 },
  { id: "omnibox", title: "Omnibox search", level: 2 },
  { id: "context-menu", title: "Context menu", level: 2 },
];

function ExtensionIllustration() {
  return (
    <svg width="160" height="80" viewBox="0 0 160 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Browser chrome */}
      <rect x="4" y="4" width="152" height="72" rx="6" fill="white" fillOpacity="0.02" stroke="white" strokeOpacity="0.08" />
      {/* Tab bar */}
      <rect x="4" y="4" width="152" height="14" rx="6" fill="white" fillOpacity="0.03" />
      <rect x="10" y="8" width="40" height="6" rx="2" fill="white" fillOpacity="0.06" />
      {/* Address bar with "dopl " */}
      <rect x="10" y="22" width="120" height="12" rx="3" fill="white" fillOpacity="0.04" stroke="white" strokeOpacity="0.06" />
      <text x="18" y="31" fill="white" fillOpacity="0.3" fontSize="7" fontFamily="monospace">dopl AI agent setup</text>
      {/* Extension icon */}
      <rect x="136" y="22" width="12" height="12" rx="2" fill="white" fillOpacity="0.08" />
      {/* Side panel */}
      <rect x="110" y="38" width="42" height="34" rx="3" fill="white" fillOpacity="0.04" stroke="white" strokeOpacity="0.08" />
      <rect x="115" y="43" width="32" height="2" rx="1" fill="white" fillOpacity="0.12" />
      <rect x="115" y="49" width="28" height="1.5" rx="0.75" fill="white" fillOpacity="0.06" />
      <rect x="115" y="54" width="30" height="1.5" rx="0.75" fill="white" fillOpacity="0.06" />
      <rect x="115" y="59" width="24" height="1.5" rx="0.75" fill="white" fillOpacity="0.06" />
    </svg>
  );
}

export function ChromeExtensionSection() {
  return (
    <div className="max-w-[720px]">
      <SectionHero
        label="Chrome Extension"
        title="Dopl in your browser"
        description="Search your knowledge base from the address bar, ingest pages with a right-click, and chat in the side panel."
      >
        <ExtensionIllustration />
      </SectionHero>

      <H2 id="extension-install">Installation</H2>
      <P>
        Download the extension from the onboarding card (or grab{" "}
        <Code>public/downloads/dopl-extension.zip</Code> directly), unzip it, then open{" "}
        <Code>chrome://extensions</Code>, enable Developer mode, and click "Load unpacked" —
        point it at the unzipped folder. For active development, you can also load{" "}
        <Code>packages/chrome-extension/dist/</Code> unpacked. The extension adds a side
        panel, omnibox search, and right-click context menu actions.
      </P>

      <H2 id="omnibox">Omnibox search</H2>
      <P>
        Type <Code>dopl</Code> followed by a space in your browser address bar, then type
        your query. Results appear as suggestions with title and summary. Click a result to
        open it, or press Enter to search in the side panel.
      </P>

      <H2 id="context-menu">Context menu</H2>
      <P>
        Right-click on any web page for these options:
      </P>
      <Table
        headers={["Action", "What it does"]}
        rows={[
          ["Ingest this page", "Sends the current page URL to Dopl for ingestion."],
          ["Ingest linked page", "Right-click a link to ingest the linked URL."],
          ["Search Dopl for selected text", "Highlight text, right-click, and search your knowledge base."],
          ["Save snippet to Dopl chat", "Send selected text to an active Dopl chat."],
        ]}
      />
    </div>
  );
}
