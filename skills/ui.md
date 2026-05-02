# UI Designer — React + Tailwind CSS v4

You are designing and building UI for a web application. Follow this design system derived from production apps. The goal is a **dense, technical aesthetic** — think Grafana, not marketing sites.

## Stack

- **Framework**: React (latest stable)
- **Styling**: Tailwind CSS v4 with `@tailwindcss/vite` plugin (no `tailwind.config.js` needed)
- **Fonts**: Inter (UI text), JetBrains Mono (code/monospace) via Google Fonts
- **Icons**: Lucide React — consistent line icon set, always `w-4 h-4` paired with text
- **Routing**: TanStack Router (file-based, type-safe)
- **Data fetching**: TanStack Query (React Query)

## Theme Setup (`app.css`)

```css
@import "tailwindcss";

@theme {
  --color-primary: #2563eb;
  --color-primary-dark: #1d4ed8;
  --color-danger: #dc2626;
  --color-success: #16a34a;
  --color-warning: #d97706;
  --font-sans: "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}
```

### Semantic Tokens (Light/Dark)

Use CSS custom properties that swap via `.dark` class on `<html>`:

| Token | Light | Dark |
|-------|-------|------|
| `--color-surface` | `#ffffff` | `#111827` |
| `--color-surface-alt` | `#f9fafb` | `#0a0f1a` |
| `--color-heading` | `#111827` | `#f9fafb` |
| `--color-body` | `#374151` | `#e5e7eb` |
| `--color-subtle` | `#4b5563` | `#d1d5db` |
| `--color-muted` | `#9ca3af` | `#6b7280` |
| `--color-border` | `#e5e7eb` | `#374151` |
| `--color-hover` | `#f9fafb` | `#1f2937` |
| `--color-selected` | `#eff6ff` | `#172554` |

## Dark Mode

- Three-state cycle: System → Light → Dark (icons: Monitor, Sun, Moon from Lucide)
- Store preference in localStorage
- FOUC prevention: inline `<script>` in `<head>` that reads localStorage and sets `.dark` class before paint
- Charts/visualizations read colors from CSS variables for automatic adaptation
- The header bar (`bg-gray-900`) is always dark in both modes

## Responsive Design — Mobile First

All base styles target mobile. Layer `md:` (768px+) and `lg:` (1024px+) for larger screens.

### Mobile Layout
- **Bottom navigation bar** for primary sections — fixed, always visible
- **No persistent sidebar** on mobile — slide-over drawer (swipe right to open)
- **Full-width cards** edge-to-edge
- **Floating action button** (FAB) bottom-right, above nav bar
- **Stacked layouts** — everything flows vertically below `lg:`
- **44px minimum** tap targets on all interactive elements
- Respect `env(safe-area-inset-*)` for notched devices

### Desktop Layout
- Sidebar navigation on `lg:+`, top tabs on `md:`
- Multi-column layouts allowed at `lg:+`

## Header

- Fixed `h-10`, always `bg-gray-900 text-white`
- Left: brand name (bold, tracking-tight) + breadcrumb + nav tabs with icons
- Right: theme toggle + user menu dropdown
- Nav tabs: `text-xs font-medium`, active = white text + gray-700 bg
- On mobile: hide breadcrumb, use back arrow instead

## Component Patterns

### Buttons
- Primary: `bg-primary text-white hover:bg-primary-dark px-2 py-1 text-xs font-medium rounded`
- Secondary: `bg-surface border border-border text-body hover:bg-hover px-2 py-1 text-xs font-medium rounded`
- Danger: `bg-danger text-white hover:bg-danger/90 px-2 py-1 text-xs font-medium rounded`
- Always icon + text with `gap-1`, icons `w-4 h-4`

### Cards
- `bg-white rounded border border-gray-200 shadow-sm` with `p-4` or `p-6`
- Dark mode: `bg-surface border-border`

### Modals
- Overlay: `bg-black/40` backdrop
- Panel: centered, `rounded-lg shadow-xl`, animate `zoom-in-95 fade-in duration-150`
- Title + close button in header, form in body, Cancel/Save right-aligned in footer
- On mobile: full-screen sheet (`inset-0 rounded-none`)
- Escape to dismiss

### Form Inputs
- `border-gray-300 rounded text-sm px-2.5 py-2 bg-surface text-heading`
- Focus: `ring-1 ring-primary border-primary`
- Labels above inputs, `text-xs font-medium text-gray-700`
- Error text in red below

### Tables / Data Grids (Preferred over cards for data)
- Sticky headers, `text-xs font-semibold text-subtle`, sortable with chevron icons
- Compact rows (~28px height), `px-2 py-1` cell padding
- Row hover highlight, selected row with blue tint
- Alternating stripe: `even:bg-gray-50`
- Skeleton loading with `animate-pulse`
- Pagination at bottom

### Toolbar
- Horizontal bar above content areas
- Left: filters, search, Import button, Export button
- Right: action buttons, Add button
- Date range pickers for time-scoped data
- On mobile: collapse into overflow menu (three-dot)

## Typography

- **Headings**: `text-sm font-semibold text-heading`
- **Body**: `text-sm text-body`
- **Labels**: `text-xs font-medium text-subtle`
- **Muted/help**: `text-xs text-muted`
- **Monospace** (numbers, code): `font-mono text-xs`

## Interaction Patterns

- Confirmation modals for destructive actions
- Toast-style feedback for mutations (success/error)
- Loading skeletons (`animate-pulse` with gray-200 blocks)
- Empty states: icon + message + CTA button
- Optimistic updates with React Query invalidation
- Pull-to-refresh on mobile

## Sign-In Screen

- Centered card on `bg-surface-alt`, `max-w-sm`, `rounded-lg shadow-sm border`
- Logo at top (if available), heading, form fields, primary button
- Optional passkey button, registration link
- Random tagline below logo

## Footer

- `text-xs text-muted`, border-top
- `(C) <year> Jeff Clement, v<version>` — fetch version from health endpoint
- Dev mode shows `DEV` instead of version
- When update available: `v1.0.5 (v1.1.0 available — upgrade)` with link

## Taglines

Every app gets ~200 short, funny taglines relevant to its domain. Show a random one on login screen, header, or footer. Keep them under 60 characters. Mix of dry wit, dad jokes, and warm humor. Generate the full set — no `// ... more` placeholders.

## Error Pages

- **404**: Fun message + tagline + link home
- **500**: Apologetic but light + retry link
- Both use the design system (dark mode aware)

## Import/Export

Every data table gets toolbar buttons for Import and Export:
- **Export**: CSV (default, UTF-8 with BOM), JSON, optionally XLSX
- **Import**: CSV + JSON minimum, preview table with validation, dry-run mode
- Clear error messages: "Row 14: 'amount' must be a number, got 'banana'"

## Rules

1. Tables over cards for data display. Density over whitespace.
2. Lines and borders over whitespace for visual separation.
3. `text-xs` and `text-sm` as primary text sizes — keep it compact.
4. Every interactive element needs a hover state and a focus ring.
5. Never break horizontal scroll — content must fit the viewport.
6. Test on mobile viewport (375px) before considering done.
