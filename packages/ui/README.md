# @bibs/ui

Shared UI component library for the **bibs** monorepo, based on [shadcn/ui](https://ui.shadcn.com/) with the **radix-nova** style.

## Tech Stack

- **Components** — [shadcn/ui](https://ui.shadcn.com/) (radix-nova style) + [Radix UI](https://www.radix-ui.com/)
- **Styling** — [Tailwind CSS v4](https://tailwindcss.com/) + [tailwind-merge](https://github.com/dcastil/tailwind-merge) + [class-variance-authority](https://cva.style/)
- **Icons** — [Lucide React](https://lucide.dev/)
- **Charts** — [Recharts](https://recharts.org/)
- **Animations** — [tw-animate-css](https://github.com/nicholasgillespie/tw-animate-css)
- **Extra** — [cmdk](https://cmdk.paco.me/), [sonner](https://sonner.emilkowal.dev/), [vaul](https://vaul.emilkowal.dev/), [react-day-picker](https://react-day-picker.js.org/), [embla-carousel](https://www.embla-carousel.com/), [input-otp](https://input-otp.rodz.dev/)

## Components

55+ components available:

accordion, alert, alert-dialog, aspect-ratio, avatar, badge, breadcrumb, button, button-group, calendar, card, carousel, chart, checkbox, collapsible, combobox, command, context-menu, dialog, direction, drawer, dropdown-menu, empty, field, hover-card, input, input-group, input-otp, item, kbd, label, menubar, native-select, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner, spinner, switch, table, tabs, textarea, toggle, toggle-group, tooltip

## Hooks

- `use-mobile` — responsive breakpoint hook

## Usage

Import components in any frontend app via the `~/` alias:

```tsx
import { Button } from "~/components/button"
import { Card, CardHeader, CardTitle, CardContent } from "~/components/card"
import { cn } from "~/lib/utils"
```

## Exports

Configured in `package.json`:

- `@bibs/ui/globals.css` → `src/styles/globals.css`
- `@bibs/ui/components/*` → `src/components/*.tsx`
- `@bibs/ui/lib/*` → `src/lib/*.ts`
- `@bibs/ui/hooks/*` → `src/hooks/*.ts`
- `@bibs/ui/postcss.config` → `postcss.config.mjs`

## Adding Components

Use the shadcn CLI with the project's `components.json` config:

```bash
bunx --bun shadcn@latest add <component> --cwd packages/ui
```

## Scripts

| Script | Description |
|---|---|
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
