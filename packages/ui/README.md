# @bibs/ui

Shared UI component library for the **bibs** monorepo, based on [shadcn/ui](https://ui.shadcn.com/) with the *
*radix-nova** style.

## Tech Stack

- **Components** — [shadcn/ui](https://ui.shadcn.com/) (radix-nova style) + [Radix UI](https://www.radix-ui.com/)
- **Styling
  ** — [Tailwind CSS v4](https://tailwindcss.com/) + [tailwind-merge](https://github.com/dcastil/tailwind-merge) + [class-variance-authority](https://cva.style/)
- **Icons** — [Lucide React](https://lucide.dev/)
- **Charts** — [Recharts](https://recharts.org/)
- **Animations** — [tw-animate-css](https://github.com/nicholasgillespie/tw-animate-css)
- **Extra
  ** — [cmdk](https://cmdk.paco.me/), [sonner](https://sonner.emilkowal.dev/), [vaul](https://vaul.emilkowal.dev/), [react-day-picker](https://react-day-picker.js.org/), [embla-carousel](https://www.embla-carousel.com/), [input-otp](https://input-otp.rodz.dev/)

## Components

55+ components available:

accordion, alert, alert-dialog, aspect-ratio, avatar, badge, breadcrumb, button, button-group, calendar, card, carousel,
chart, checkbox, collapsible, combobox, command, context-menu, dialog, direction, drawer, dropdown-menu, empty, field,
hover-card, input, input-group, input-otp, item, kbd, label, menubar, native-select, navigation-menu, pagination,
popover, progress, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner,
spinner, switch, table, tabs, textarea, toggle, toggle-group, tooltip

## Hooks

- `use-mobile` — responsive breakpoint hook

## Usage

Import components in any frontend app via the `~/` alias:

```tsx
import {Button} from "~/components/button"
import {Card, CardHeader, CardTitle, CardContent} from "~/components/card"
import {cn} from "~/lib/utils"
```

## Exports

Configured in `package.json`:

- `@bibs/ui/globals.css` → `src/styles/globals.css`
- `@bibs/ui/components/*` → `src/components/*.tsx`
- `@bibs/ui/lib/*` → `src/lib/*.ts`
- `@bibs/ui/hooks/*` → `src/hooks/*.ts`
- `@bibs/ui/postcss.config` → `postcss.config.mjs`

## Useful Component Libraries

Third-party registries and libraries compatible with shadcn/ui:

- **[shadcn/ui](https://ui.shadcn.com/docs/components)** — official component docs and registry
- **[kibo-ui](https://www.kibo-ui.com/)** — advanced components built on top of shadcn/ui (data table, kanban, gantt,
  timeline, calendar, etc.)
- **[magic-ui](https://magicui.design/)** — animated components and effects
- **[animate-ui](https://animate-ui.com/)** — motion primitives for shadcn/ui
- **[cult/ui](https://www.cult-ui.com/)** — craft-focused components for design-intensive UIs
- **[shadcn-extension](https://shadcn-extension.vercel.app/)** — community extensions (multi-select, tree view,
  carousel, etc.)
- **[shadcn-table](https://shadcn-table.vercel.app/)** — feature-rich data table with sorting, filtering, and pagination
- **[plate](https://platejs.org/)** — rich text editor built on shadcn/ui
- **[coss-ui](https://coss.com/)** — ready-to-use input, form and layout components
- **[farmui](https://farmui.com/)** — additional animated shadcn/ui components
- **[efferd](https://efferd.com/)** — additional components
- **[mapcn](https://mapcn.vercel.app/)** — maps
- **[uitripled](https://ui.tripled.work/)** — UI tripleD
- **[badtz-ui](https://www.badtz-ui.com/)** — BadtzUI
- **[Lucide Animated](https://lucide-animated.com/)** — Lucide animated icon library
- **[shadcnblocks](https://www.shadcnblocks.com/)** — pre-built page blocks and sections for shadcn/ui
- **[Aceternity UI](https://ui.aceternity.com/)** — eye-catching animated components and effects
- **[Tailark](https://tailark.com/)** — Tailwind CSS component blocks and templates

## Registries

`components.json` declares three sources the shadcn CLI (v3+) and the `shadcn` MCP server can resolve:

| Namespace | Source | Auth |
|---|---|---|
| _(unprefixed)_ | [shadcn/ui](https://ui.shadcn.com/docs/components) — default registry | none |
| `@kibo-ui` | [Kibo UI](https://www.kibo-ui.com/) — advanced components (data table, kanban, gantt, …) | none |
| `@shadcnblocks` | [Shadcnblocks](https://www.shadcnblocks.com/) — pre-built page blocks & sections (we hold an **Elite lifetime license**) | `Bearer ${SHADCNBLOCKS_API_KEY}` |

### `@shadcnblocks` setup (one-time, per developer)

The block catalog lives at <https://www.shadcnblocks.com/blocks>. Browsing requires a paid account; the dashboard at <https://www.shadcnblocks.com/dashboard/api> issues the API key tied to the bibs license.

```bash
cp packages/ui/.env.example packages/ui/.env.local
# paste the key into SHADCNBLOCKS_API_KEY=
```

`.env.local` is gitignored. **Important**: the shadcn CLI loads env files from the shell's working directory (`process.cwd()`), not from `--cwd`. Always `cd packages/ui` before running install commands — `--cwd packages/ui` alone is not enough for env interpolation to pick up the key. The `shadcn` MCP server (declared in `.mcp.json` with `--cwd ./packages/ui`) reads the same file — restart Claude Code after creating it.

> Note: the registry URL in `components.json` uses `www.shadcnblocks.com` (not the bare `shadcnblocks.com` shown in the official setup snippet). The bare host 308-redirects to `www.`, and HTTP clients drop the `Authorization` header on cross-host redirects, producing a confusing 401.

## Adding Components

Use the shadcn CLI from inside `packages/ui/` so it picks up both `components.json` and `.env.local`:

```bash
cd packages/ui

# Default shadcn/ui registry
bunx --bun shadcn@latest add <component>

# Namespaced registries
bunx --bun shadcn@latest add @kibo-ui/<component>
bunx --bun shadcn@latest add @shadcnblocks/<block>
```

Use `--dry-run` first when trying a new block — it lists the files and deps the install would touch without writing anything.

## Scripts

| Script              | Description                       |
|---------------------|-----------------------------------|
| `bun run typecheck` | TypeScript check (`tsc --noEmit`) |

## Structure

```text
src/
├── components/    # All UI components (.tsx)
├── hooks/         # React hooks
├── lib/
│   └── utils.ts   # cn() utility (clsx + tailwind-merge)
└── styles/
    └── globals.css # Tailwind base + CSS variables (zinc theme)
```
