# Dev portal design system

One implementation for the Design Playground and every overhauled page, so a page cannot drift from the Playground.

## The rule

Pages compose `ui.tsx` and `ui-page.tsx`. A page in `_sections` imports no `_design/*.module.css` and has no CSS module of its own. `design-guard.test.ts` enforces this for the pages listed in it; add a page to that list when it moves.

## Scale

`--u` in `tokens.module.css` and `U` in `components.tsx` are the one scale; change them together. Size can change, ratios cannot: every length multiplies `--u`, so one value moves everything. Samuel settled it at 0.72 on 2026-10-30.

## Components

- `ui.tsx`: Button, SplitButton, Badge, StateDot, Chip, Card, Stat, StatCard, Meter, MeterFigure, SearchField, NavRow, DataTable, DataRow, DataCell, TwoLine, plus Segmented, PillMenu, PopMenu.
- `ui-page.tsx`: Text, Row, Between, Stack, Grow, Page, PageHeader, StatRow, Toolbar, FilterRow, EmptyState, Toast, Mark, CardSection, CardHead, ChipRow, FigureWell, Figure, CardFoot, Spark, AddCard, BoxRow, ListRow, FigureGrid, TableFoot, MenuItem, Pager, SideSheet, FlowDialog, Tiles, Tile, ReviewWell, ConfirmDialog, Alert, TextField, SecretWell, CodeBlock.

- `ui-sidebar.tsx`: Sidebar, NavGroup, ProjectPicker, AccountRow, SearchPanel, SearchHit, SearchEmpty.

- `ui-output.tsx`: Stage, SplitLayout, LensScreen, PanelScreen, SpeakerOutput, HapticOutput, ChangeOutput, ReadOutput, CaptureOutput. InkPanel, InkQuote, InkPrompt, InkFoot (the black frame), StatStrip, ThreeUp, AvatarStack, PickRow. A call draws by capability, never by device. `g2-screen.tsx`: G2Screen, the 576x288 G2 display on Even's font metrics.

- `ui-data.tsx`: BarChart, Limit, Timeline, LineChart, Ring.

## Adding a variation

Add it as a prop in `_design`, show it in the Playground gallery, then use it. No page-level overrides of height, padding, radius, font size or gap. Components take no `className`.

## Checking

Compare a render against the Playground; matching CSS numbers is not enough. `Text` and layout parts carry type and spacing, so a page should read as composition only.
