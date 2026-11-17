---
name: Shift Tools Native Desktop
colors:
  surface: '#131319'
  surface-dim: '#131319'
  surface-bright: '#39383f'
  surface-container-lowest: '#0e0e14'
  surface-container-low: '#1b1b21'
  surface-container: '#1f1f25'
  surface-container-high: '#2a2930'
  surface-container-highest: '#34343b'
  on-surface: '#e4e1ea'
  on-surface-variant: '#c0c6d6'
  inverse-surface: '#e4e1ea'
  inverse-on-surface: '#303036'
  outline: '#8b91a0'
  outline-variant: '#414754'
  surface-tint: '#aac7ff'
  primary: '#aac7ff'
  on-primary: '#003064'
  primary-container: '#3e90ff'
  on-primary-container: '#002957'
  inverse-primary: '#005db8'
  secondary: '#47e266'
  on-secondary: '#003910'
  secondary-container: '#09bf49'
  on-secondary-container: '#004615'
  tertiary: '#e9b3ff'
  on-tertiary: '#510074'
  tertiary-container: '#c863fb'
  on-tertiary-container: '#460066'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d6e3ff'
  primary-fixed-dim: '#aac7ff'
  on-primary-fixed: '#001b3e'
  on-primary-fixed-variant: '#00468d'
  secondary-fixed: '#6cff82'
  secondary-fixed-dim: '#47e266'
  on-secondary-fixed: '#002106'
  on-secondary-fixed-variant: '#00531a'
  tertiary-fixed: '#f6d9ff'
  tertiary-fixed-dim: '#e9b3ff'
  on-tertiary-fixed: '#310048'
  on-tertiary-fixed-variant: '#7200a3'
  background: '#131319'
  on-background: '#e4e1ea'
  surface-variant: '#34343b'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: '600'
    lineHeight: 22px
    letterSpacing: -0.012em
  headline-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: -0.008em
  body-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: -0.004em
  body-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: -0.002em
  body-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 15px
    letterSpacing: 0em
  mono-lg:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: -0.01em
  mono-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: -0.01em
  mono-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '400'
    lineHeight: 13px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0em
  label-sm:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 12px
    letterSpacing: 0.03em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 0.75rem
  gutter-sm: 0.5rem
  gutter-lg: 1rem
  margin: 0.75rem
  margin-sm: 0.5rem
  margin-lg: 1.25rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system targets professional software engineers, site reliability specialists, network architects, and penetration testers who demand high information density, terminal-grade precision, and the polished ergonomics of macOS Sonoma and Sequoia.

The design movement combines **Liquid Glassmorphism** with **Technical Precision Minimalism**:
- **Tactile Optics**: Materials employ deep optical blur (`backdrop-filter: blur(24px)` to `blur(40px)`), high-specular top borders simulating light catch on beveled glass, and dark substrate transparency (`rgba(18, 18, 24, 0.72)`).
- **Desktop Utility Ergonomics**: The visual rhythm respects native macOS paradigms—window traffic lights, slim unified toolbars, segmented controller tabs, and compact data grids engineered for low cognitive fatigue during intense debugging workflows.
- **Instrument-Grade Character**: Technical tokens, hex dumps, IPv6 subnets, process identifiers (PIDs), and latency readouts are treated as first-class UI citizens through distinct typographic and chromatic categorization.

## Colors

The palette is engineered specifically for deep-contrast macOS dark environments. It leverages vibrant system accents layered over obsidian glass substrates:

- **Primary (`#0a84ff` - Electric Blue)**: Primary interactive states, active tab indicators, focused split views, and telemetry selection.
- **Secondary (`#30d158` - Emerald Green)**: Healthy socket connections, open ports (SYN/ACK), passed test suites, and cryptographic verification statuses.
- **Tertiary (`#bf5af2` - Cyber Purple)**: Cryptographic signatures, JWT payload decoders, TLS handshake attributes, and entropy visualization.
- **Warning (`#ffd60a` - Solar Yellow)**: Latency spikes, self-signed certificates, DNS propagation delays, and memory threshold warnings.
- **Destructive / Error (`#ff453a` - Coral Red)**: Process SIGKILL, terminated sockets, packet drops, and syntax failures.
- **Base Substrates**:
  - Window Root Canvas: `#0a0a0f`
  - Floating Panels & Glass Surfaces: `#121218` (alpha modulated between 0.65 and 0.85)
  - Translucent Overlay Hover: `rgba(255, 255, 255, 0.05)`
  - Translucent Border Rim: `rgba(255, 255, 255, 0.12)` top edge, `rgba(255, 255, 255, 0.04)` lateral/bottom edges

## Typography

The typographic strategy balances human interface navigation with raw technical output:

- **Inter** fulfills all macOS chrome duties (window title headers, contextual menu items, setting descriptions, and primary navigation labels). It offers high legibility at dense macOS sub-13px scales.
- **JetBrains Mono** governs all dynamic data: CIDR blocks, MAC addresses, hex displays, payload inspection viewers, HTTP raw requests, execution timers, and socket payloads.
- **Hierarchy Rules**:
  - `label-sm` is uppercase with wide letter tracking (`0.03em`) for table headers, section dividers, and badge prefixes.
  - Monospace variants maintain strict tabular figures (`tnum`) for synchronized real-time packet counters and delta metrics.

## Layout & Spacing

The layout is grounded in a rigorous **4px desktop grid** tailored for utility density:

- **Desktop Window Architecture**: A 3-pane native desktop model featuring a collapsible utility sidebar (200px - 260px), a secondary inspector panel (280px - 340px), and a flexible primary telemetry/workbench canvas.
- **Header & Titlebar**: 52px unified macOS titlebar accommodating standard traffic lights (`12px` discs with `8px` spacing), title metadata, breadcrumbs, search, and segmented tool filters.
- **Density Profile**: Compact vertical footprint. Data row heights are pinned to `28px` for data lists and `32px` for interactive tree-views, maximizing visible payloads above the fold without sacrificing click targets.

## Elevation & Depth

Visual depth is achieved through translucent material tiers and optical refraction instead of opaque heavy drop shadows:

1. **Layer 0 (Canvas Base)**: `#0a0a0f` solid background with ambient gradient noise.
2. **Layer 1 (Glass Panes & Sidebars)**: `rgba(18, 18, 24, 0.75)` backdrop blur of `30px`, bounded by a hairline border: `1px solid rgba(255, 255, 255, 0.08)`.
3. **Layer 2 (Inspector Cards & Workbenches)**: `rgba(26, 26, 36, 0.65)` backdrop blur of `20px`, accompanied by a simulated top specular rim: `box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.14)`.
4. **Layer 3 (Modals, Popovers & Context Menus)**: `rgba(22, 22, 30, 0.92)` backdrop blur of `40px`, with a dual-stage shadow:
   - Ambient drop: `0 16px 32px -8px rgba(0, 0, 0, 0.65)`
   - Specular perimeter: `0 0 0 1px rgba(255, 255, 255, 0.16)`
5. **Active Accent Rim**: Critical elements utilize subtle ambient glow shadows tinted with their respective semantic color (e.g., `0 0 12px rgba(10, 132, 255, 0.35)` for primary focus rings).

## Shapes

The design system adopts refined macOS radii:
- Standard interactive elements (buttons, text inputs, table row selections) use `rounded` (0.5rem / 8px).
- Internal content cards, split view buckets, and log panes scale up to `rounded-lg` (1rem / 16px).
- Modals, detached glass sheets, and app-level floating windows employ `rounded-xl` (1.5rem / 24px).
- Badges, status pills, and segmented switch indicators leverage fully rounded caps (`rounded-full` / 9999px) to establish instant optical separation from rectilinear data matrices.

## Components

### Title Bar & Window Header
- **Traffic Light Alignment**: Positioned `16px` from left edge, vertically centered within the `52px` header height.
- **Unified Header**: Integrated search input and segmented tab controls reside directly inside the toolbar using translucent glass capsules.

### Buttons & Segmented Controls
- **Segmented Controls**: Embedded in an ultra-dark glass track (`rgba(0, 0, 0, 0.3)`), active tabs have a luminous `rgba(255, 255, 255, 0.1)` surface, high top-edge specular highlight (`inset 0 1px 0 rgba(255, 255, 255, 0.2)`), and crisp white text.
- **Action Buttons**:
  - *Default*: Translucent obsidian (`rgba(255, 255, 255, 0.06)`), 1px border (`rgba(255, 255, 255, 0.1)`), 8px border-radius, 28px height.
  - *Primary*: Electric Blue (`#0a84ff`) gradient to `#0066cc`, white label, subtle top edge highlight.
  - *Destructive*: Coral Red (`rgba(255, 69, 58, 0.15)`), red rim border (`rgba(255, 69, 58, 0.4)`), text `#ff453a`.

### Status Badges & Pills
- Pill-shaped (`height: 20px`, `padding: 0 8px`), utilizing high-legibility `mono-sm` typography.
- Background uses 12% opacity tint of semantic color; border uses 25% opacity tint.
- Includes a 6px glowing radial status beacon for live connections (Emerald Green with ping animation).

### Data Tables & Stream Viewers
- Alternate row striping using subtle alpha adjustments (`rgba(255, 255, 255, 0.015)`).
- Sticky header with frosted backdrop (`backdrop-filter: blur(16px)`), uppercase `label-sm` labels, and 1px bottom border.
- Hover states render as `rgba(255, 255, 255, 0.04)` with rounded 4px selection bounds.

### Input Fields & Monospace Editors
- Recessed inputs with `rgba(0, 0, 0, 0.4)` background, inset shadow `inset 0 1px 2px rgba(0, 0, 0, 0.6)`.
- Focused state transitions border to Electric Blue (`#0a84ff`) with a 2px outer glow (`rgba(10, 132, 255, 0.25)`).
- Monospace payload views include line numbers in muted gray (`#48484a`) and syntax highlighting mapped to the semantic palette.