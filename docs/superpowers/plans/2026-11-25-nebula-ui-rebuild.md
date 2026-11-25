# Nebula UI Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the AI Video Studio interface around the nebula theme and a clearer desktop workspace layout, with zero functional regressions.

**Architecture:** Introduce a single token block per theme in `src/styles/theme.css`, map it into Tailwind/shadcn variables, then rebuild the shell and each screen with presentation-only changes. Behavior, props, state, fetch calls, and API routes stay untouched except for one local selection state in Quick Clip.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind CSS v4, `@base-ui/react`, shadcn-style primitives, Vitest (node environment), Bun.

**Spec:** `docs/superpowers/specs/2026-11-25-nebula-ui-rebuild-design.md`

## Global Constraints

- Nebula is the only theme. Every token lives in `src/styles/theme.css`; a future theme is one sibling `[data-theme="..."]` block plus a `src/lib/theme.ts` registry entry.
- No `dark:` utilities anywhere in `src/`. No `.dark` block, no `@custom-variant dark`, no `dark` class on `<html>`.
- Desktop-only. Do not add mobile layouts, mobile hit areas, or mobile QA. Leave existing mobile markup functional and untouched.
- Presentation only. Do not change API routes, `src/lib` provider/job logic, `src/db`, hooks, component props, exported names, or request bodies. Quick Clip may add local UI selection state.
- Keep every field, action, status, error, and retry reachable.
- Use semantic status tokens (`warning`, `success`, `info`, `destructive`, `neutral`) instead of raw palette colors.
- `bun run test`, `bun run lint`, and `bun run build` must pass at every commit.
- Doc sync: when a task changes architecture, update `AGENTS.md` and `README.md` in the same commit. `.env.example` changes only if env keys change (they do not).
- No secrets and no new runtime directories.

## Review Focus

- **Long text in tight surfaces:** 120-character project titles, scene titles, element names, model IDs, and file paths must truncate or wrap without breaking cards, badges, sidebar rows, or dialogs.
- **Long failure messages:** provider errors shown in `JobStatusBadge` tooltips, warning banners, and the Quick Clip main panel must stay readable and keep Retry reachable.
- **Empty data:** zero projects, scenes, elements, clips, takes, or presets must render an actionable empty state, never a blank or collapsed panel.
- **Active job visibility:** status badges and active-job counts must remain visible and stable while polling, without layout shift.
- **Keyboard and disabled states:** every rebuilt pill, segmented control, row action, and dialog must keep a visible focus ring and must not activate while disabled.

---

### Task 1: Nebula token foundation, fonts, and token-only primitives

**Files:**
- Create: `src/styles/theme.css`
- Create: `src/lib/theme.ts`
- Test: `tests/theme.test.ts`
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Modify: `package.json`, `bun.lock` (via `bun add`)
- Modify: `src/components/ui/button.tsx`, `input.tsx`, `textarea.tsx`, `select.tsx`, `tabs.tsx`, `badge.tsx`
- Modify: `AGENTS.md`, `README.md`

**Interfaces:**
- Produces: `THEMES: readonly { id: "nebula"; label: "Nebula"; scheme: "dark" }[]`
- Produces: `type ThemeId = "nebula"`
- Produces: `const DEFAULT_THEME: ThemeId = "nebula"`
- Produces CSS custom properties listed below, consumed by every later task.

- [ ] **Step 1: Write the failing theme test**

Create `tests/theme.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, THEMES } from "@/lib/theme";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8");

describe("nebula theme foundation", () => {
  it("registers nebula as the only default theme", () => {
    expect(THEMES.map((theme) => theme.id)).toEqual(["nebula"]);
    expect(DEFAULT_THEME).toBe("nebula");
    expect(THEMES[0]).toMatchObject({ label: "Nebula", scheme: "dark" });
  });

  it("defines nebula tokens in one theme block", () => {
    const css = read("src/styles/theme.css");
    expect(css).toContain('[data-theme="nebula"]');
    for (const token of [
      "--background:",
      "--card:",
      "--primary:",
      "--primary-2:",
      "--primary-3:",
      "--warning:",
      "--success:",
      "--info:",
      "--border:",
      "--radius:",
    ]) {
      expect(css).toContain(token);
    }
  });

  it("has no dark-mode class variants or block", () => {
    const walk = (dir: string): string[] =>
      readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
        const relative = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(relative);
        return /\.(tsx|css)$/.test(entry.name) ? [relative] : [];
      });

    for (const file of walk("src")) {
      expect(read(file)).not.toContain("dark:");
    }
    const globals = read("src/app/globals.css");
    expect(globals).not.toContain("@custom-variant dark");
    expect(globals).not.toMatch(/^\.dark\s*\{/m);
  });

  it("sets the default theme on the html element", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain("data-theme={DEFAULT_THEME}");
    expect(layout).not.toContain('className="dark');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test tests/theme.test.ts`
Expected: FAIL — `Cannot find module '@/lib/theme'` or missing theme file.

- [ ] **Step 3: Install self-hosted fonts**

Run: `bun add @fontsource-variable/inter @fontsource-variable/jetbrains-mono`
Expected: both packages in `dependencies`, `bun.lock` updated.

- [ ] **Step 4: Create `src/lib/theme.ts`**

```ts
export const THEMES = [
  { id: "nebula", label: "Nebula", scheme: "dark" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const DEFAULT_THEME: ThemeId = "nebula";
```

- [ ] **Step 5: Create `src/styles/theme.css` with the single nebula block**

Use exactly these values:

```css
[data-theme="nebula"] {
  color-scheme: dark;
  --background: #0b0716;
  --background-2: #0f0a1d;
  --card: #140d25;
  --card-foreground: #f2edfb;
  --popover: #140d25;
  --popover-foreground: #f2edfb;
  --surface-2: #1b1331;
  --surface-3: #241a40;
  --border: #e1cdff14;
  --border-strong: #e1cdff26;
  --input: #e1cdff26;
  --foreground: #f2edfb;
  --muted: #1b1331;
  --muted-foreground: #b5a9cd;
  --subtle-foreground: #7e7298;
  --primary: #c79bff;
  --primary-foreground: #1a0b2e;
  --primary-2: #ff8fd8;
  --primary-3: #5ee7ff;
  --secondary: #1b1331;
  --secondary-foreground: #f2edfb;
  --accent: #241a40;
  --accent-foreground: #f2edfb;
  --destructive: #ff6b8a;
  --destructive-foreground: #1a0b2e;
  --warning: #ffb86b;
  --success: #5ee7b4;
  --info: #5ee7ff;
  --ring: #c79bff;
  --glow-1: #c79bff2e;
  --glow-2: #ff8fd81f;
  --glow-3: #5ee7ff12;
  --grid: #e1cdff0a;
  --selection: #c79bff4d;
  --shadow: 0 24px 60px -24px #05000fd9;
  --radius: 16px;
  --sidebar: #0f0a1d;
  --sidebar-foreground: #f2edfb;
  --sidebar-primary: #c79bff;
  --sidebar-primary-foreground: #1a0b2e;
  --sidebar-accent: #1b1331;
  --sidebar-accent-foreground: #f2edfb;
  --sidebar-border: #e1cdff14;
  --sidebar-ring: #c79bff;
  --chart-1: #c79bff;
  --chart-2: #ff8fd8;
  --chart-3: #5ee7ff;
  --chart-4: #ffb86b;
  --chart-5: #5ee7b4;
}
```

- [ ] **Step 6: Rewrite `src/app/globals.css`**

- Imports: `tailwindcss`, `tw-animate-css`, `shadcn/tailwind.css`, then `../styles/theme.css`.
- Keep the existing `@theme inline` mappings and add `--color-background-2`, `--color-surface-2`, `--color-surface-3`, `--color-border-strong`, `--color-subtle-foreground`, `--color-primary-2`, `--color-primary-3`, `--color-warning`, `--color-success`, `--color-info`, each pointing at its variable.
- Set `--font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif`, `--font-heading` to the same stack, and `--font-mono: "JetBrains Mono Variable", ui-monospace, monospace`.
- Set explicit radii: `--radius-sm: 10px`, `--radius-md: 12px`, `--radius-lg: var(--radius)` (16px), `--radius-xl: 24px`; keep the 2xl/3xl/4xl `calc()` mappings.
- Delete the entire `.dark { ... }` block and `@custom-variant dark`.
- Base layer: `* { @apply border-border outline-ring/50; }`, `html { @apply font-sans; }`, `body { @apply bg-background text-foreground; }`, `::selection { background: var(--selection); }`.
- Add component utilities:
  - `.panel` — `background: color-mix(in oklab, var(--card) 88%, transparent)`, 1px `var(--border)`, `border-radius: var(--radius)`, inset top highlight `inset 0 1px 0 #ffffff0a`, plus `var(--shadow)`.
  - `.panel-hover:hover` — `border-color: var(--border-strong)` and a soft `var(--glow-1)` outer ring.
  - `.prism-text` — 100deg gradient `var(--primary) → var(--primary-2) 55% → var(--primary-3)`, clipped to text.
  - `.prism-line` — 1px horizontal gradient line, 55% opacity.
  - `.eyebrow` — 13px, 600 weight, uppercase, `letter-spacing: .08em`, `color: var(--primary)`, inline-flex with an 18×2px gradient dash.
  - `.media-tile` — dashed `var(--border-strong)`, `var(--surface-2)` at 40%, `border-radius: 12px`.
  - `.ambient-glow` — `radial-gradient(closest-side, var(--glow-1), transparent)`.
  - `.grid-veil` — two linear-gradient grid lines at 52px, masked to fade from the top.

- [ ] **Step 7: Update `src/app/layout.tsx`**

- Import `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono` before `./globals.css`.
- Import `DEFAULT_THEME` from `@/lib/theme`.
- `<html lang="en" data-theme={DEFAULT_THEME} className="h-full antialiased">`.
- Remove the `dark` class. Do not change the body structure yet.

- [ ] **Step 8: Remove all `dark:` utilities from the six primitives**

Delete every `dark:` token in `button.tsx`, `input.tsx`, `textarea.tsx`, `select.tsx`, `tabs.tsx`, and `badge.tsx` (13 occurrences). Leave the non-dark classes unchanged in this task; visual restyling happens in Task 2.

- [ ] **Step 9: Update docs**

- `AGENTS.md` architecture map: add `src/styles/theme.css` (single theme token block) and `src/lib/theme.ts` (theme registry).
- `AGENTS.md` Global Constraints: add “Single theme: color comes from `data-theme` tokens; never add `dark:` utilities or a `.dark` block.”
- `README.md`: add a short “Theme” section naming nebula, the token file, and how to add a future theme.

- [ ] **Step 10: Run the test, lint, and build**

Run: `bun run test tests/theme.test.ts`
Expected: PASS.

Run: `bun run lint`
Expected: PASS.

Run: `bun run build`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add package.json bun.lock src/styles/theme.css src/lib/theme.ts src/app/globals.css src/app/layout.tsx src/components/ui tests/theme.test.ts AGENTS.md README.md
git commit -m "feat: add nebula theme tokens and self-hosted fonts"
```

---

### Task 2: UI primitives and semantic job statuses

**Files:**
- Create: `src/lib/ui/status.ts`
- Test: `tests/job-status-tone.test.ts`
- Modify: `src/components/JobStatusBadge.tsx`
- Modify: `src/components/ui/button.tsx`, `card.tsx`, `input.tsx`, `textarea.tsx`, `select.tsx`, `tabs.tsx`, `badge.tsx`, `dialog.tsx`, `tooltip.tsx`, `sonner.tsx`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces: `type StatusTone = "neutral" | "info" | "success" | "warning" | "destructive"`
- Produces: `jobStatusTone(status: JobStatus): StatusTone`
- Produces `Badge` variants: `accent`, `info`, `success`, `warning` (plus existing names).
- Consumes: theme tokens from Task 1.

- [ ] **Step 1: Write the failing status test**

Create `tests/job-status-tone.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { JOB_STATUSES } from "@/db/schema";
import { jobStatusTone } from "@/lib/ui/status";

describe("jobStatusTone", () => {
  it("maps every job status", () => {
    for (const status of JOB_STATUSES) {
      expect(jobStatusTone(status)).toBeTruthy();
    }
  });

  it("uses semantic tones", () => {
    expect(jobStatusTone("QUEUED")).toBe("neutral");
    expect(jobStatusTone("PENDING")).toBe("info");
    expect(jobStatusTone("RUNNING")).toBe("info");
    expect(jobStatusTone("DOWNLOADING")).toBe("info");
    expect(jobStatusTone("READY")).toBe("success");
    expect(jobStatusTone("FAILED")).toBe("destructive");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test tests/job-status-tone.test.ts`
Expected: FAIL — cannot resolve `@/lib/ui/status`.

- [ ] **Step 3: Implement `src/lib/ui/status.ts`**

```ts
import type { JobStatus } from "@/db/schema";

export type StatusTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "destructive";

const JOB_STATUS_TONES: Record<JobStatus, StatusTone> = {
  QUEUED: "neutral",
  PENDING: "info",
  RUNNING: "info",
  DOWNLOADING: "info",
  READY: "success",
  FAILED: "destructive",
};

export function jobStatusTone(status: JobStatus): StatusTone {
  return JOB_STATUS_TONES[status];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test tests/job-status-tone.test.ts`
Expected: PASS.

- [ ] **Step 5: Restyle the primitives**

Keep every API, variant name, size, and export. Apply these visual decisions:

- **Button:** `rounded-full font-semibold`; default `bg-primary text-primary-foreground shadow-[inset_0_1px_0_#ffffff40,0_10px_28px_-12px_var(--primary)] hover:bg-primary/90`; outline `border-border-strong bg-surface-2/60 hover:bg-surface-3`; secondary `bg-secondary hover:bg-surface-3`; ghost `hover:bg-surface-2`; destructive `border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20`; link unchanged. Keep all size heights as they are.
- **Card:** replace the `bg-card ... ring-1 ring-foreground/10` base with the `.panel` class, keep `text-card-foreground`, and use `rounded-[var(--radius)]`. Keep the card spacing variables and all subcomponents.
- **Input / Textarea / Select trigger:** `rounded-xl border-border-strong bg-surface-2/70`, `focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/25`, placeholder `text-subtle-foreground`, disabled `bg-surface-2/40`.
- **Tabs:** list `rounded-full border border-border bg-surface-2/70 p-1`; trigger `rounded-full text-muted-foreground`, active `bg-surface-3 text-foreground shadow-[inset_0_1px_0_#ffffff14]`; keep `data-active` behavior.
- **Badge:** `h-6 rounded-full`; add variants `accent` (`bg-primary/12 text-primary border-primary/30`), `info` (`bg-info/12 text-info border-info/30`), `success` (`bg-success/12 text-success border-success/30`), `warning` (`bg-warning/12 text-warning border-warning/30`); update destructive to `bg-destructive/12 text-destructive border-destructive/30`; outline `border-border-strong bg-surface-2/40`.
- **Dialog:** overlay `bg-black/60 backdrop-blur-sm`; content `rounded-[var(--radius-lg)] border border-border-strong bg-popover shadow-[var(--shadow)]`.
- **Select popup:** `rounded-xl border border-border-strong bg-popover shadow-[var(--shadow)]`, items `focus:bg-surface-3 focus:text-foreground`.
- **Tooltip:** `bg-surface-3 text-foreground border border-border-strong` and matching arrow colors.
- **Sonner:** keep `theme="dark"`; set `--normal-bg: var(--surface-2)`, `--normal-text: var(--foreground)`, `--normal-border: var(--border-strong)`, `--border-radius: var(--radius)`.

- [ ] **Step 6: Update `JobStatusBadge`**

Replace the six hard-coded `classes` strings with a tone → variant map:

```ts
const TONE_VARIANT: Record<StatusTone, "secondary" | "info" | "success" | "warning" | "destructive"> = {
  neutral: "secondary",
  info: "info",
  success: "success",
  warning: "warning",
  destructive: "destructive",
};
```

Keep labels, icons, spin/pulse flags, tooltip behavior, and the `errorMessage` path. Use `variant={TONE_VARIANT[jobStatusTone(status)]}` and remove the per-status class strings.

- [ ] **Step 7: Update `AGENTS.md`**

Add `src/lib/ui/status.ts` to the architecture map and note that job status colors come from `jobStatusTone()` and semantic badge variants.

- [ ] **Step 8: Run tests, lint, and build**

Run: `bun run test tests/job-status-tone.test.ts`
Expected: PASS.

Run: `bun run lint`
Expected: PASS.

Run: `bun run build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/ui/status.ts tests/job-status-tone.test.ts src/components/JobStatusBadge.tsx src/components/ui AGENTS.md
git commit -m "feat: restyle ui primitives and add semantic job status tones"
```

---

### Task 3: App shell, ambient backdrop, page header, empty state

**Files:**
- Create: `src/components/AmbientBackdrop.tsx`
- Create: `src/components/PageHeader.tsx`
- Create: `src/components/EmptyState.tsx`
- Modify: `src/components/NavSidebar.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces: `AmbientBackdrop(): React.ReactElement` (no props).
- Produces: `PageHeader({ eyebrow?: string; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode })`.
- Produces: `EmptyState({ icon: LucideIcon; title: string; description: string; children?: React.ReactNode })`.
- `NavSidebar` keeps its current export and no props.

- [ ] **Step 1: Create `AmbientBackdrop`**

A fixed, `aria-hidden`, `pointer-events-none` layer at `-z-10` containing two `.ambient-glow` blobs near the top-left and top-right of the content area plus one `.grid-veil` at the top. No content interaction.

- [ ] **Step 2: Create `PageHeader`**

Layout: optional `.eyebrow`, `h1` at `text-3xl font-bold tracking-tight`, optional description at `text-sm text-muted-foreground max-w-2xl`, and a right-aligned `actions` cluster that wraps. Callers may pass a `<span className="prism-text">` inside `title` for a gradient word.

- [ ] **Step 3: Create `EmptyState`**

A `.panel` centered block: icon inside a 56px rounded gradient ring, title `text-base font-semibold`, description `text-sm text-muted-foreground max-w-md`, then `children` as actions.

- [ ] **Step 4: Rebuild the desktop sidebar in `NavSidebar`**

- Keep the existing mobile `<header>` block unchanged.
- Desktop `<aside>`: `md:flex md:w-[272px] md:shrink-0 md:flex-col border-r border-border bg-sidebar/80 backdrop-blur`.
- Brand: 36px rounded-xl gradient mark (lavender → pink) with `Film` icon, product name, and `Local-first` micro-label.
- Nav groups `Workspace` (Projects, Quick Clip) and `System` (Settings) with uppercase group labels at `text-[11px] tracking-[0.14em] text-subtle-foreground`.
- Nav rows: 40px, icon + label, active `bg-surface-2 text-foreground` with a 2px lavender left indicator and soft glow; hover `bg-surface-2/60`.
- Footer: `.panel` card with “Local SQLite + Disk” and “Keys from .env.local” text, using `text-xs text-muted-foreground`.

- [ ] **Step 5: Update the layout shell**

In `src/app/layout.tsx`, keep the body as a column/row flex shell for mobile compatibility, render `<AmbientBackdrop />` before the shell, wrap `NavSidebar` and `main` in a `relative z-0 flex min-h-screen` container, and set `main` to `min-w-0 flex-1 px-8 py-8 lg:px-12` with an inner `mx-auto w-full max-w-[1200px]`. Do not add new data fetching.

- [ ] **Step 6: Update `AGENTS.md`**

Add the three new components to the architecture map.

- [ ] **Step 7: Verify**

Run: `bun run lint`
Expected: PASS.

Run: `bun run build`
Expected: PASS.

Manual: start `bun run dev`, check sidebar active states on `/`, `/quick-clip`, `/settings`, confirm no content is hidden behind the ambient layer, and tab through nav links with visible focus.

- [ ] **Step 8: Commit**

```bash
git add src/components/AmbientBackdrop.tsx src/components/PageHeader.tsx src/components/EmptyState.tsx src/components/NavSidebar.tsx src/app/layout.tsx AGENTS.md
git commit -m "feat: rebuild app shell with nebula sidebar and page header"
```

---

### Task 4: Projects dashboard

**Files:**
- Create: `src/components/ProjectCard.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Produces: `ProjectCard({ project: Project; featured?: boolean })`.
- Consumes: `PageHeader`, `EmptyState`, `Badge`, `Button`, `Card`, `Dialog`, `Input`, `Select`, `Textarea`.
- Preserves: all existing fetch calls, state, `handlePresetChange`, `handleCreateProject`, dialog fields, and `router.push`.

- [ ] **Step 1: Create `ProjectCard`**

Wrap the card in `<Link href={`/projects/${project.id}`}>`. Card uses `.panel panel-hover`, `h-full`, and when `featured` spans two columns on `lg`. Contents: badges row (`aspectRatio · resolution`), title `text-lg font-semibold line-clamp-1`, slug in mono `text-xs text-subtle-foreground truncate`, synopsis `text-sm text-muted-foreground line-clamp-2`, and a bottom meta row with model chip (`font-mono text-xs`) and updated date. Keep the hover border/glow. Never drop the synopsis fallback chain (`roughIdea || refinedStory || "No synopsis yet."`).

- [ ] **Step 2: Rebuild the dashboard header and banner**

Replace the inline header with `PageHeader` (`eyebrow="Workspace"`, title `Projects`, description unchanged, actions = Quick Clip ghost, Settings icon ghost, New Project primary). Convert the unconfigured warning into a `.panel` with warning tokens, `AlertTriangle`, the same copy, and `Open Settings`.

- [ ] **Step 3: Rebuild the project grid and empty state**

- Loading: centered `Loader2` with “Loading projects…”.
- Empty: `EmptyState` with `Sparkles`, “No projects yet”, existing copy, and the two existing CTAs.
- Non-empty: grid `gap-5 sm:grid-cols-2 lg:grid-cols-3`; render `projects.map((project, index) => <ProjectCard featured={index === 0} ... />)`.

- [ ] **Step 4: Restyle the New Project dialog**

Widen to `sm:max-w-2xl`. Keep every field and handler. Group as: title (full width), rough idea (full width), style preset + style bible, then a three-column row for aspect/resolution/model. Use the existing labels, placeholders, required flags, and footer buttons.

- [ ] **Step 5: Verify**

Run: `bun run lint`
Expected: PASS.

Run: `bun run build`
Expected: PASS.

Manual: open `/` with no projects (empty state), with projects (featured + grid), open the dialog, change preset (style bible fills), submit a project, and check the warning banner. Resize to 1024px and confirm the featured card and grid do not overflow.

- [ ] **Step 6: Commit**

```bash
git add src/components/ProjectCard.tsx src/app/page.tsx
git commit -m "feat: rebuild projects dashboard"
```

---

### Task 5: Studio header and stage rail

**Files:**
- Create: `src/components/studio/StageRail.tsx`
- Modify: `src/components/studio/StageTabs.tsx`

**Interfaces:**
- Produces: `StageRail(): React.ReactElement` (no props; must be rendered inside `Tabs`).
- Preserves: `StageTabs` loading/error states, fetch effects, `useJobs`, ready-count refresh, `activeTab` values, and all stage props.

- [ ] **Step 1: Create `StageRail`**

Use `TabsList` and `TabsTrigger` from `@/components/ui/tabs`. Define:

```ts
const STAGES = [
  { value: "stage1", label: "Story & Scenes", hint: "Concept, elements, script", icon: Sparkles },
  { value: "stage2", label: "Elements & Keyframes", hint: "Reference sheets, first/last frames", icon: Layers },
  { value: "stage3", label: "Video & Export", hint: "Clips, takes, Kdenlive", icon: Film },
] as const;
```

Render a `TabsList` with `grid w-full grid-cols-3 gap-1 rounded-2xl border border-border bg-surface-2/60 p-1.5`. Each trigger is a two-line cell: numbered circle (1/2/3), label, hint. Active trigger gets `bg-surface-3 text-foreground` and a lavender glow; visited/upcoming states are handled by the existing tab styling. Do not add completion checks.

- [ ] **Step 2: Rebuild the project header in `StageTabs`**

- Sticky container: `sticky top-0 z-20 -mx-8 border-b border-border bg-background/85 px-8 py-4 backdrop-blur` (adjust negative margins to the layout padding).
- Left: back icon button, title `text-2xl font-bold tracking-tight`, then badges for aspect, resolution, model, and active-job count. Keep the active-job `Loader2` badge and count logic.
- Right: a compact “Stage 2 of 3” or progress label derived from `activeTab` (display only).
- Below: `<StageRail />`.

- [ ] **Step 3: Replace the old tab list**

Remove the old `<TabsList className="grid w-full max-w-xl grid-cols-3">` block and render `<StageRail />`. Keep `Tabs`, `value`, `onValueChange`, and all `TabsContent` panels unchanged.

- [ ] **Step 4: Verify**

Run: `bun run lint`
Expected: PASS.

Run: `bun run build`
Expected: PASS.

Manual: open a project, switch all three stages, confirm keyboard arrow navigation still works, the sticky header does not overlap content at 1024px, and the active-job badge still appears when jobs are active.

- [ ] **Step 5: Commit**

```bash
git add src/components/studio/StageRail.tsx src/components/studio/StageTabs.tsx
git commit -m "feat: rebuild studio header and stage rail"
```

---

### Task 6: Stage 1 story, element roster, and scene cards

**Files:**
- Modify: `src/components/studio/Stage1Story.tsx`
- Modify: `src/components/studio/SceneCard.tsx`

**Interfaces:**
- Preserves: every handler (`handleAutoRefine`, `runAutoRefine`, save story, add/delete element, add/reorder/delete scene, polish, save scene, add/remove linked element), every dialog, every field, and all props.

- [ ] **Step 1: Rebuild the story panel**

Convert the first `Card` into a `.panel` with a section header: eyebrow `Stage 1`, title “Story Concept & Auto-Refine”, description. Put target-scene-count input and `Auto-Refine` in the header action cluster. Body: rough idea textarea full width, then a two-column grid for Refined Story and Style Bible, then the save row. Keep the “Save as Preset” action and its disabled rule.

- [ ] **Step 2: Rebuild the element roster**

Panel header: title with count, description. Add form stays one row (`150px 1fr 2fr auto` on `md`). Group the three kind shelves into `grid gap-4 md:grid-cols-3`; each shelf is `rounded-xl border border-border bg-surface-2/30 p-3`. Element rows get a kind-colored dot/initial, name, 2-line description, and a hover-revealed delete button. Keep the empty text per kind.

- [ ] **Step 3: Rebuild the scenes section**

Section header: `Scenes (n)`, description, `Add Scene`, and the existing `Continue to Stage 2` conditional. Empty state uses `EmptyState` with the same guidance. Keep the `SceneCard` key `${scene.id}-${scene.updatedAt}`.

- [ ] **Step 4: Rebuild `SceneCard`**

- Card becomes a numbered timeline card: left index rail (`#01`, move up/down buttons, delete), right content.
- Header: editable title input (keep current behavior), badges, and save state.
- Body groups: Visual Prompt + AI Polish; Camera / Video Mode / Duration; Audio Mode + Audio Script; Linked Elements chips + link select + unknown-element warning; save row.
- Keep every label, placeholder, min/max, disabled rule, and handler.
- Long titles use `truncate`/`line-clamp`; linked chips wrap.

- [ ] **Step 5: Verify**

Run: `bun run lint`
Expected: PASS.

Run: `bun run build`
Expected: PASS.

Manual: auto-refine confirm dialog, save story, save preset dialog, add/delete element, add scene, reorder, edit/save scene, link/unlink element, delete scene. Use a 120-character scene title and confirm no overflow.

- [ ] **Step 6: Commit**

```bash
git add src/components/studio/Stage1Story.tsx src/components/studio/SceneCard.tsx
git commit -m "feat: rebuild stage 1 story and scene cards"
```

---

### Task 7: Stage 2 elements, keyframes, and voiceover

**Files:**
- Modify: `src/components/studio/Stage2Elements.tsx`
- Modify: `src/components/studio/ElementCard.tsx`

**Interfaces:**
- Preserves: `ElementCard` generate/upload/set-active/retry handlers, keyframe generation, batch dialog, TTS expand/generate handlers, and all props.

- [ ] **Step 1: Rebuild the reference sheets section**

Section header with `Elements (n)`, description, and a `.panel` grid `sm:grid-cols-2 lg:grid-cols-3`. Keep the empty state. Each `ElementCard` uses `.panel panel-hover`.

- [ ] **Step 2: Rebuild `ElementCard`**

- Header: kind badge (character/prop/location tint via `accent`/`info`/`warning` variants), truncated name, description.
- Preview: square media area with `media-tile` empty state; keep `activeImagePath`.
- Actions: prompt override input, Generate Sheet, Upload, hidden file input.
- Version history: horizontal thumbnails, active ring, version label, Set Active button. Keep all handlers and disabled rules.

- [ ] **Step 3: Rebuild scene keyframes**

Each scene becomes a `.panel` with header (scene number, title, mode/duration badges, 2-line prompt) and a two-column body of media tiles for first/last keyframe. Keep the image, empty state, status badge, retry, generate button, and active/optional labels.

- [ ] **Step 4: Rebuild the TTS panel**

Keep the collapsible behavior. Restyle the trigger as a full-width row with `ChevronDown/Right`, `Volume2`, title, description, and an Expand/Hide badge. Body rows keep scene number, title, audio mode, status, retry, text input, voice select, and generate action.

- [ ] **Step 5: Verify**

Run: `bun run lint`
Expected: PASS.

Run: `bun run build`
Expected: PASS.

Manual: generate/retry element sheet, upload a sheet, set active version, generate/retry first and last keyframes, open batch keyframes, expand TTS and generate. Confirm empty states for zero elements/scenes.

- [ ] **Step 6: Commit**

```bash
git add src/components/studio/Stage2Elements.tsx src/components/studio/ElementCard.tsx
git commit -m "feat: rebuild stage 2 elements and keyframes"
```

---

### Task 8: Stage 3 clips, shot strip, takes, and export

**Files:**
- Modify: `src/components/studio/Stage3Video.tsx`
- Modify: `src/components/studio/ShotStrip.tsx`
- Modify: `src/components/studio/TakeHistory.tsx`
- Modify: `src/components/studio/ExportPanel.tsx`

**Interfaces:**
- Preserves: scene clip generation, mode changes, uploads/removals, retry, shot selection, take switching, batch dialog, export rebuild/download, and all props.

- [ ] **Step 1: Rebuild the Stage 3 header**

Panel header: `Film` icon, title “Video Clips & Shot Review”, description, right-side badges (`readyClipsCount / scenes.length clips ready`), Back to Stage 2, and Generate All Clips. Keep disabled rules.

- [ ] **Step 2: Rebuild `ShotStrip` as a filmstrip**

Horizontal scroll of `w-44` cards with `.panel`, active `border-primary ring-2 ring-primary/40` + soft glow. Keep video/keyframe thumbnails, scene number badge, Clip/Keyframe badge (use `success`/`neutral` semantic variants, not emerald/zinc), title truncation, and duration. Keep the `onSelectScene` click behavior.

- [ ] **Step 3: Rebuild the clip panels**

Each scene card uses `.panel`, selected state `border-primary/70`. Header: scene number, title, duration, `JobStatusBadge`, failed Retry, Generate Clip. Body: dropped-elements warning with warning tokens; video preview; `MediaModePicker`; mode-not-submittable message; `TakeHistory`. Keep every conditional.

- [ ] **Step 4: Rebuild `TakeHistory`**

Rows in `grid gap-2 sm:grid-cols-2`; active row `border-success/40 bg-success/8`; thumbnail 80×48; version mono; created date; Active badge (`success`); Set Active button. Keep all handlers and disabled rules.

- [ ] **Step 5: Rebuild `ExportPanel`**

Gradient-edged `.panel` feature block: `Archive` icon, title, description, Rebuild Export, Download ZIP. Keep error panel, export folder row, `project.kdenlive` download, missing-scenes warning (warning tokens), all-clips success (success tokens), and exported file badges.

- [ ] **Step 6: Verify**

Run: `bun run lint`
Expected: PASS.

Run: `bun run build`
Expected: PASS.

Manual: select shots, switch modes, upload/remove media, generate/retry a clip, switch takes, open batch dialog, rebuild export, download ZIP. Confirm failed-job errors remain readable and Retry is reachable.

- [ ] **Step 7: Commit**

```bash
git add src/components/studio/Stage3Video.tsx src/components/studio/ShotStrip.tsx src/components/studio/TakeHistory.tsx src/components/studio/ExportPanel.tsx
git commit -m "feat: rebuild stage 3 clips, takes, and export"
```

---

### Task 9: Quick Clip workspace

**Files:**
- Modify: `src/app/quick-clip/page.tsx`

**Interfaces:**
- Adds local state: `const [selectedJobId, setSelectedJobId] = useState<string | null>(null)`.
- Derives:
  ```ts
  const readyVideoJobs = videoJobs.filter((job) => job.status === "READY");
  const selectedJob =
    videoJobs.find((job) => job.id === selectedJobId) ??
    readyVideoJobs[0] ??
    videoJobs[0];
  ```
- Preserves: every field, `handleGenerate`, `handlePolish`, mode/upload/remove handlers, retry, disabled logic, and `useJobs`.

- [ ] **Step 1: Add the selection state**

Add the state and derived values above. Do not remove any job from the list.

- [ ] **Step 2: Rebuild the page header and layout**

Use `PageHeader` (`eyebrow="Workspace"`, title `Quick Clip`, existing description). Layout: `grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]`. Composer left, output panel right with `xl:sticky xl:top-8`.

- [ ] **Step 3: Rebuild the composer**

Keep the form and all fields. Order: prompt + Polish Prompt, model/audio/resolution/ratio/duration grid, `MediaModePicker`, submit error (destructive tokens), mode hint (warning tokens), large primary Generate Clip button aligned right. Use `.panel` for the composer.

- [ ] **Step 4: Rebuild the output panel**

- Main area: selected job status badge, model, time, failed error (destructive tokens) + Retry, and a `<video controls>` when READY with a result asset. If READY but the asset is still loading, keep the “Loading video preview…” line.
- Recent list: every `videoJobs` row, clickable to set `selectedJobId`, showing status, model, time, and inline Retry for failures. Selected row gets `border-primary/50 bg-primary/5`.
- Empty state when no jobs. Keep the 3-second polling copy.
- If no job is selected and none exist, show an `EmptyState`.

- [ ] **Step 5: Verify**

Run: `bun run lint`
Expected: PASS.

Run: `bun run build`
Expected: PASS.

Manual: switch modes, upload/remove media, polish, submit, select different jobs, confirm failed errors and Retry remain visible, and confirm the output panel sticks at 1440px.

- [ ] **Step 6: Commit**

```bash
git add src/app/quick-clip/page.tsx
git commit -m "feat: rebuild quick clip workspace"
```

---

### Task 10: Settings layout

**Files:**
- Modify: `src/app/settings/page.tsx`

**Interfaces:**
- Preserves: `loadAll`, `handleTestConnection`, custom model add/delete, preset add/delete, status rendering, and all fields.

- [ ] **Step 1: Add the section nav**

Use `PageHeader` with a Refresh action. Below it, a sticky in-page nav with anchor links to `#provider-status`, `#custom-models`, and `#style-presets`. Layout: `grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]`, nav left sticky at `top-8`, content right.

- [ ] **Step 2: Rebuild the provider status section**

Wrap in `.panel` with `id="provider-status"`. Header: title, description, Test Qwen / Test OpenAI-Compat / Test All buttons. Body: Qwen sub-panel with key/region badges, definition rows (masked key, base URL, default models, text/TTS), key/URL mismatch warning, test result panels (success/destructive tokens); text refiner provider panel with base URL/model/masked key or the Qwen fallback copy.

- [ ] **Step 3: Rebuild custom models**

`.panel` with `id="custom-models"`. Add form as a five-column row on `sm+`; list rows with model ID, display name, modality, family, delete action. Keep empty state.

- [ ] **Step 4: Rebuild style presets**

`.panel` with `id="style-presets"`. Add form, then a `sm:grid-cols-3` preset card grid with name, description, delete. Keep empty state.

- [ ] **Step 5: Rebuild the unconfigured banner**

Use warning tokens, keep the same copy and the `.env.local` instructions.

- [ ] **Step 6: Verify**

Run: `bun run lint`
Expected: PASS.

Run: `bun run build`
Expected: PASS.

Manual: test connection buttons, add/delete custom model, add/delete preset, anchor nav scrolls to each section, banner renders when unconfigured.

- [ ] **Step 7: Commit**

```bash
git add src/app/settings/page.tsx
git commit -m "feat: rebuild settings layout"
```

---

### Task 11: Semantic color sweep

**Files:**
- Modify: `tests/theme.test.ts`
- Modify: any `src/**/*.tsx` still using raw palette colors.

**Interfaces:**
- Consumes: `warning`, `success`, `info`, `destructive`, `surface-2/3`, `border-strong` tokens from Task 1.

- [ ] **Step 1: Add the failing sweep test**

Append to `tests/theme.test.ts`:

```ts
it("uses semantic status tokens instead of raw palette colors", () => {
  const roots = ["src/app", "src/components"];
  const offenders: string[] = [];

  const walk = (dir: string): string[] => {
    const entries = readdirSync(path.join(ROOT, dir), { withFileTypes: true });
    return entries.flatMap((entry) => {
      const relative = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(relative);
      return entry.name.endsWith(".tsx") ? [relative] : [];
    });
  };

  for (const file of roots.flatMap(walk)) {
    if (/(?:amber|blue|emerald|red|green|zinc|indigo|slate)-\d{2,3}/.test(read(file))) {
      offenders.push(file);
    }
  }

  expect(offenders).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test tests/theme.test.ts`
Expected: FAIL with a non-empty `offenders` list.

- [ ] **Step 3: Replace every offender**

Mapping:

- Warning → `border-warning/40 bg-warning/10 text-warning`, icon `text-warning`.
- Success → `border-success/40 bg-success/10 text-success`, icon `text-success`.
- Info/active → `border-info/40 bg-info/10 text-info`, icon `text-info`.
- Destructive → `border-destructive/40 bg-destructive/10 text-destructive`, icon `text-destructive`.
- Neutral chips → `border-border bg-surface-2 text-muted-foreground`.
- Keep `bg-black` for video letterboxing and `text-white` only on top of `bg-black/70` overlays.

Do not change any conditional logic; only class names.

- [ ] **Step 4: Run the sweep test and full suite**

Run: `bun run test tests/theme.test.ts`
Expected: PASS.

Run: `bun run test`
Expected: PASS.

Run: `bun run lint`
Expected: PASS.

Run: `bun run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/theme.test.ts src
git commit -m "refactor: replace raw status colors with semantic tokens"
```

---

### Task 12: Docs and final verification

**Files:**
- Modify: `AGENTS.md`, `README.md` (final pass)

**Interfaces:**
- No code interfaces. Verifies the whole spec.

- [ ] **Step 1: Final docs sync**

- `AGENTS.md`: architecture map includes `src/styles/theme.css`, `src/lib/theme.ts`, `src/lib/ui/status.ts`, `PageHeader`, `EmptyState`, `AmbientBackdrop`, `ProjectCard`, `StageRail`.
- `AGENTS.md`: constraints state nebula-only, `data-theme` tokens, no `dark:` utilities, desktop-only UI scope.
- `README.md`: short “Interface” section describing the new shell, stage rail, Quick Clip split, and theme token file.
- Confirm `.env.example` needs no change (no env keys added).

- [ ] **Step 2: Run the full verification suite**

Run: `bun run test`
Expected: PASS.

Run: `bun run lint`
Expected: PASS.

Run: `bun run build`
Expected: PASS.

- [ ] **Step 3: Manual QA (desktop, no paid generation)**

Run: `bun run dev`, then at 1440px and 1024px:

- Dashboard: empty state, project grid, New Project dialog, preset auto-fill, warning banner.
- Studio: stage rail switching, sticky header, stage 1 all actions, stage 2 all actions, stage 3 selection/takes/export, dialogs.
- Quick Clip: mode switching, uploads, selection, failed-error display, Retry.
- Settings: anchors, connection tests, model/preset add/delete.
- Keyboard: tab through nav, stage rail, dialogs, row actions; focus ring visible; disabled controls do not activate.
- Long text: 120-character project/scene/element names and a long model ID do not overflow.
- Empty data: use the empty project/stage states or a temporary local fixture; do not delete user data.

Paid generation calls are blocked by decision (no provider key). Record them as blocked, not passed.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md README.md
git commit -m "docs: document nebula theme and verify ui rebuild"
```
