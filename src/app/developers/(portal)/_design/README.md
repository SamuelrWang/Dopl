# Dev portal design system

One implementation for the Design Playground and every overhauled page, so a page cannot drift from the Playground.

## The rule

Pages compose `ui.tsx`, `ui-page.tsx` and `ui-overlay.tsx`. A page in `_sections` imports no `_design/*.module.css` and has no CSS module of its own. `design-guard.test.ts` enforces this for the pages listed in it; add a page to that list when it moves.

## Scale

`--u` in `tokens.module.css` and `U` in `components.tsx` are the one scale; change them together. Size can change, ratios cannot: every length multiplies `--u`, so one value moves everything. Samuel settled it at 0.72 on 2026-10-30.

## Components

- `ui.tsx`: Button, Badge, StateDot, Chip, Card, Stat, StatCard, Meter, MeterFigure, SearchField, NavRow, DataTable, DataRow, DataCell, TwoLine, plus Segmented, SegmentedBy, PillMenu, PopMenu.
- `ui-page.tsx`: Text, Row, Between, Stack, Grow, Page, PageHeader, StatRow, Toolbar, FilterRow, FilterChips, EmptyState, Toast, Mark, CardSection, CardHead, ChipRow, FigureWell, Figure, CardFoot, Spark, AddCard, BoxRow, ListRow, FigureGrid, TableFoot, MenuItem, Pager, ReviewWell, Alert, ProblemAlert, TextField, SecretWell, CopyButton, CopyWell, CodeBlock.

- `ui-overlay.tsx`: SideSheet, FlowDialog, DoneFoot, Tiles, Tile, ConfirmDialog.

- `ui-sidebar.tsx`: PortalFrame, Sidebar, NavGroup, ProjectSwitcher, AccountRow, SearchPanel, SearchHit, SearchEmpty.

- `ui-output.tsx`: Stage, SplitLayout, LensScreen, PanelScreen, SpeakerOutput, HapticOutput, ChangeOutput, ReadOutput, CaptureOutput. InkPanel, InkQuote, InkFoot (the black frame), StatStrip, ThreeUp, AvatarStack, PickRow. A call draws by capability, never by device. `g2-screen.tsx`: G2Screen, the 576x288 G2 display on Even's font metrics.

- `ui-extras.tsx`: CodeCells, DateRange, PlanCard, Banner, StatTriple.
- `ui-data.tsx`: BarChart, Limit, Timeline, LineChart, Ring.

- `ui-docs.tsx`: the docs site (`src/features/marketing/docs`). DocNavSlot, DocMain, DocMobileBar, DocFootActions, DocBrand, NavFolder, NavSubhead, NavAnchors, DocColumn, DocHead, DocSplit, DocIntro, DocFoot, DocSocial, Prose, Inline, Anchored, DocGrid, Callout, InkCopy, CodeTabs, DocEndpoint, ParamRow, DocTable, DocSteps, DocFlow, DocFacts, DocLog.

## Adding a variation

Add it as a prop in `_design`, show it in the Playground gallery, then use it. No page-level overrides of height, padding, radius, font size or gap. Components take no `className`.

## Checking

Compare a render against the Playground; matching CSS numbers is not enough. `Text` and layout parts carry type and spacing, so a page should read as composition only.
