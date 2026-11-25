# Nebula UI Rebuild — Design

**Date:** 2026-11-25
**Status:** Awaiting approval
**Scope:** Presentation layer only. No functional, API, data-model, or job-runner changes.

## Intent

Rebuild the entire AI Video Studio interface around the **nebula** theme from
`santoshkurmi.com.np/antigem`, and restructure the layout so the app is easier to
navigate and understand. The current UI is stock shadcn dark: neutral grays, no
brand identity, hard-coded amber/blue status colors, and dense nested cards that
make it hard to see what stage you are in or what to do next.

Nebula supplies the visual identity. WonderClip supplies the workspace pattern:
a persistent left rail, a composer paired with a preview, a storyboard strip, and
an asset library. We adapt both to this app's existing 3-stage story workflow.

Nebula ships as the **only** theme now. Every color, radius, shadow, and font
token lives in one theme block, so additional themes can be added later by
copying one block and switching `data-theme` — no component changes required.

## Goals

1. Apply the full nebula visual language to every screen: dashboard, project
   studio (all three stages), Quick Clip, Settings, dialogs, menus, and toasts.
2. Restructure the shell and page layouts so the current stage, the next action,
   and the project context are obvious at a glance.
3. Keep every existing behavior, field, handler, conditional, and API call intact.
4. Centralize theming so a future theme switcher is a small, additive change.
5. Replace hard-coded status colors with semantic tokens (`warning`, `success`,
   `info`, `destructive`) that stay legible on the nebula background.

## Non-goals

- No new routes, pages, or backend features.
- No multi-theme switcher in this pass.
- No changes to `src/app/api/*`, `src/lib/*`, `src/db/*`, hooks, job logic, or
  provider behavior.
- No replacement of `@base-ui/react` primitives or a new component library.
- No marketing-style full-height hero on app screens; the app stays dense and
  task-focused. Glow is decoration, not a readability trade-off.

## Anti-goals

- Glow or gradient behind text fields, tables, or long-form reading areas.
- Color-only status communication; every status keeps an icon and/or label.
- Decorative motion that ignores `prefers-reduced-motion`.
- Touching event handlers while moving markup.

## Constraints

- Next.js 16 App Router, React 19, Tailwind CSS v4, `@base-ui/react` + shadcn-style
  primitives, Bun, Node runtime.
- `bun run test`, `bun run lint`, and `bun run build` must pass.
- Public API and component props stay compatible.
- Existing tests must pass unchanged.
- No secrets, no new runtime directories.

## Approaches considered

**A. Token remap only.** Swap CSS variables and fonts, keep all layouts. Cheap
but does not deliver the requested rebuild; rejected.

**B. Nebula design system + shell and screen rebuild (chosen).** Build tokens and
presentational primitives, then rebuild the shell and every screen's layout while
leaving all behavior untouched.

**C. Rewrite every screen and component from scratch.** Highest visual ceiling,
but re-implements working interaction code for no functional gain and increases
regression risk; rejected because functionality must not be compromised.

## Theme architecture

### Files

- `src/styles/theme.css` — **the single place** for theme tokens. One
  `[data-theme="nebula"]` block now; future themes are added as sibling blocks.
- `src/app/globals.css` — imports `theme.css`, maps tokens to Tailwind/shadcn
  variables via `@theme inline`, and defines the shared visual utilities.
- `src/app/layout.tsx` — sets `data-theme="nebula"` on `<html>`, loads fonts,
  renders the ambient backdrop and shell.
- `src/lib/theme.ts` — small metadata registry (`id`, `label`, `scheme`) used by
  the future switcher. Not rendered yet.

### Tokens (nebula)

| Token | Value | Use |
|---|---|---|
| `--background` | `#0b0716` | app base |
| `--background-2` | `#0f0a1d` | rails, footer bands |
| `--card` | `#140d25` | panel surface |
| `--surface-2` | `#1b1331` | inputs, raised rows |
| `--surface-3` | `#241a40` | active/hover surfaces |
| `--border` | `#e1cdff14` | default hairlines |
| `--border-strong` | `#e1cdff26` | hover, focused containers |
| `--foreground` | `#f2edfb` | primary text |
| `--muted-foreground` | `#b5a9cd` | secondary text |
| `--subtle-foreground` | `#7e7298` | tertiary text |
| `--primary` | `#c79bff` | lavender brand/accent |
| `--primary-2` | `#ff8fd8` | pink accent |
| `--primary-3` | `#5ee7ff` | cyan accent |
| `--primary-foreground` | `#1a0b2e` | text on lavender |
| `--warning` | `#ffb86b` | warnings, dropped elements |
| `--success` | `#5ee7b4` | ready/complete |
| `--info` | `#5ee7ff` | active jobs |
| `--destructive` | `#ff6b8a` | destructive |
| `--glow-1/2/3` | lavender/pink/cyan at 8–18% | ambient glows |
| `--grid` | `#e1cdff0a` | background grid |
| `--selection` | `#c79bff4d` | text selection |
| `--radius` | `16px` | base panel radius (sm 10, lg 24) |

shadcn tokens (`background`, `foreground`, `card`, `popover`, `primary`,
`secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`,
`sidebar-*`) map onto these values so existing utility classes keep working.

Primitives become token-only: every `dark:` utility is removed (13 occurrences
across `button`, `input`, `textarea`, `select`, `tabs`, and `badge`) and replaced
with the semantic tokens above. The `dark` class is removed from `<html>` and the
`.dark` token block and `@custom-variant dark` are deleted. Color is driven only
by `data-theme`, so a future theme — dark or light — needs no component changes.
`next-themes` stays installed and unused, as today.

### Typography

- **Inter Variable** for UI and headings, tight tracking (`-0.025em` to `-0.045em`
  on display sizes).
- **JetBrains Mono Variable** for slugs, model IDs, scene numbers, code.
- Loaded from `@fontsource-variable/*` (self-hosted, deterministic offline build).
- Type scale: page title 30–36px/750, section title 18–20px/650, body 14–16px,
  label 12–13px uppercase tracking.

### Shared visual utilities

Defined once in `globals.css`:

- `.ambient` — fixed radial glows + masked grid behind content.
- `.panel` — surface + hairline border + inner top highlight + soft shadow.
- `.panel-hover` — border/glow transition on hover.
- `.prism-text` — lavender → pink → cyan gradient text.
- `.prism-line` — 1px gradient divider.
- `.eyebrow` — uppercase accent label with a short gradient dash.
- `.media-tile` — dashed glass tile for uploads/empty media.
- `.status-dot` — 6px colored dot with matching glow.

## Shell

Desktop (`md+`):

```
┌──────────────┬─────────────────────────────────────────────┐
│ brand mark   │  page header (eyebrow / title / actions)    │
│              │                                             │
│ WORKSPACE    │  content                                    │
│  Projects    │                                             │
│  Quick Clip  │                                             │
│              │                                             │
│ SYSTEM       │                                             │
│  Settings    │                                             │
│              │                                             │
│ [local card] │                                             │
└──────────────┴─────────────────────────────────────────────┘
```

- Sidebar 272px, translucent surface over `background-2`, right hairline.
- Brand: gradient gem/film mark with soft outer glow, product name, and a
  `Local-first` micro-label.
- Nav items: 40px rows, icon + label, active = raised pill with lavender left
  indicator and subtle glow; hover = surface-2.
- Footer card: storage/runtime facts, restyled, no new data.
- Ambient backdrop: two soft radial glows at the top of the content area plus a
  masked 52px grid. Fixed, `pointer-events-none`, low opacity, never over text.

Mobile is out of scope: the app runs locally on desktop. The existing mobile top
bar stays functional and untouched; no mobile-specific layout, hit-area, or QA
work is part of this pass. Existing responsive grid classes remain as they are.

Page header component: eyebrow, title, one-line description, action cluster.
Used on Projects, Quick Clip, Settings, and the project studio.

## Screen layouts

### Projects dashboard

- Header: eyebrow `Workspace`, title, description, actions: `Quick Clip`
  (ghost), `Settings` (icon ghost), `New Project` (primary pill).
- Unconfigured-provider warning becomes a warning panel with icon, copy, and
  `Open Settings`.
- With projects: featured card for the most recently updated project (spans two
  columns on large screens) + grid of the rest. Card: badges, title, slug,
  synopsis, model chip, updated date, hover border + glow.
- Empty state: centered constellation panel with gradient icon ring, copy, and
  `Create First Project` + `Try Quick Clip`.
- New-project dialog: wider, two-column form groups, same fields and submit
  handler.

### Project studio

- Sticky project bar: back button, project title, aspect/resolution/model badges,
  active-job badge, and a 3-step rail.
- Step rail replaces the plain tab strip: numbered circles, label + sublabel,
  connector line; the active step glows lavender, previously visited steps
  brighten, upcoming steps stay muted. No completion check is shown: completion
  would require new readiness rules, and a check on an empty stage would lie.
  Progress is derived from the active tab index only. Still implemented with the
  existing `Tabs` primitives so keyboard and panel behavior are unchanged.
- Stage 1 — Story & Scenes:
  - Story panel: rough idea, target scene count + `Auto-Refine` in the panel
    header; refined story and style bible side by side; save row.
  - Element roster panel: add form as one row; three kind shelves (characters,
    props, locations) with counts and compact element rows.
  - Scenes: header with `Add Scene` and `Continue to Stage 2`; each `SceneCard`
    becomes a numbered timeline card with a left index rail, title, reorder and
    delete actions, prompt + polish, camera/mode/duration, audio, linked-element
    chips, and save row.
- Stage 2 — Elements & Keyframes:
  - Reference sheets grid with kind-colored accents and image/status areas.
  - Scene keyframes: one panel per scene with scene meta on the left and two
    16:9 media tiles (first/last) with generate actions and status badges.
  - Optional TTS panel stays collapsible.
- Stage 3 — Video & Export:
  - Shot strip becomes a filmstrip: horizontal thumbnails, active ring + glow,
    per-scene status dots, scene number and duration.
  - Each clip panel: header with status/retry/generate, video preview, media mode
    picker, take history thumbnails.
  - Export panel becomes a gradient-edged feature panel with export action and
    project summary.
- Empty states in each stage point to the previous stage action.

### Quick Clip

- Two-column on `xl`: composer left (2/3), sticky output/recent panel right (1/3).
- Composer: model select, media-mode segmented control, prompt textarea, settings
  grid (ratio/resolution/duration/audio), media tiles, and a large primary
  `Generate Clip` button. All existing fields and disabled logic preserved.
- Output panel: one main player plus a selectable recent-clips list. The most
  recent READY job loads into the main player by default. Each recent row keeps
  its status badge, inline error message, and Retry button; selecting a READY
  row swaps it into the main player. Selection is local UI state only. No clip
  or failure action becomes unreachable. Stacks below the composer on smaller
  screens.

### Settings

- Page header plus a sticky in-page section nav (Provider Status, Custom Models,
  Style Presets) using anchor links.
- Provider status panel: configured state, key details as definition rows,
  endpoint/model chips, test-connection button.
- Custom models: list rows with add form; clear edit/delete affordances.
- Style presets: card grid with name, description, and delete.
- Warning banner uses warning tokens.

## Component work

Restyle primitives (classes only, same APIs):

- `Button` — pill radii, lavender primary with inner highlight + glow, surface
  ghost/outline, tinted destructive, size scale preserved.
- `Card` — `.panel`, 16px radius, hairline border, inner highlight, no heavy ring.
- `Input`, `Textarea`, `Select` — surface-2, 12px radius, accent focus ring.
- `Tabs` — segmented pill list; active trigger raised with accent text.
- `Badge` — pill; semantic variants: accent, info, success, warning, destructive,
  neutral.
- `Dialog` — surface panel, backdrop blur, 20px radius, gradient top hairline.
- `Tooltip`, `Sonner` toasts — nebula surfaces and accent icons.

New presentational components:

- `PageHeader`
- `AmbientBackdrop`
- `StageRail` (wraps existing tab triggers)
- `EmptyState`
- `StatusBadge` helpers for semantic status styling
- `ProjectCard` extraction from the dashboard

No new data fetching. Recent-project data in the sidebar is **not** added in this
pass.

## Behavior preservation

- Do not change hooks, state, effects, fetch calls, request bodies, API routes,
  database code, or job logic.
- Do not change component props or exported names.
- Keep all `aria-*`, `title`, `disabled`, conditional rendering, and keyboard
  behavior.
- Markup may be reorganized and re-classed; handlers move with their elements.
- Keep every field, button, and status visible somewhere in the new layout.
- Tests remain untouched and must pass.

## Verification

1. `bun run test`
2. `bun run lint`
3. `bun run build`
4. Manual click-through at 1440px and 1024px. No provider key is
   available in this workspace, by decision: paid generation calls are out of
   this pass. Verify every non-paid path (layout, forms, dialogs, validation,
   disabled states, navigation, export wiring) and mark live generation steps as
   blocked, not passed.
   - Dashboard: load, create project, warning banner, empty state.
   - Stage 1: auto-refine confirm, save story, add/delete element, add scene,
     reorder, edit/save/delete scene, save preset.
   - Stage 2: generate keyframe, retry, batch keyframes, TTS expand/generate.
   - Stage 3: generate clip, switch take, retry failed job, shot strip select,
     export download.
   - Quick Clip: mode switching, uploads, generate, recent clips.
   - Settings: test connection, add/delete custom model, add/delete preset.
5. Keyboard focus visible on every interactive element; reduced motion respected.

## Risks and mitigations

- **Hard-coded color utilities** scattered across screens: sweep with a grep for
  `amber|blue|emerald|red|green|slate|zinc` and replace with semantic tokens.
- **Sticky project bar + tabs**: keep sticky inside the content column, verify no
  overlap with the header at 1024px.
- **Font loading offline**: self-hosted fontsource packages avoid network builds.
- **Visual regressions in dense forms**: keep panel backgrounds calm; glow only
  on page headers, active states, and empty states.
- **Scope creep**: no new routes or features; if a layout change would require
  new data, leave it out and note it.

## Left to the builder

- Exact spacing values within the stated scale.
- Icon choices from `lucide-react` where not specified.
- Whether the stage rail uses a check icon or a filled number for completed
  steps.
- Precise hover/transition timings within 150–250ms and the shared easing curve.
