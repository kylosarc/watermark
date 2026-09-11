---
name: Digital Forensics & Provenance Engine
colors:
  surface: '#101419'
  surface-dim: '#101419'
  surface-bright: '#36393f'
  surface-container-lowest: '#0a0e14'
  surface-container-low: '#181c21'
  surface-container: '#1c2025'
  surface-container-high: '#262a30'
  surface-container-highest: '#31353b'
  on-surface: '#e0e2ea'
  on-surface-variant: '#bcc9cd'
  inverse-surface: '#e0e2ea'
  inverse-on-surface: '#2d3136'
  outline: '#869397'
  outline-variant: '#3d494c'
  surface-tint: '#4cd7f6'
  primary: '#4cd7f6'
  on-primary: '#003640'
  primary-container: '#06b6d4'
  on-primary-container: '#00424f'
  inverse-primary: '#00687a'
  secondary: '#d0bcff'
  on-secondary: '#3c0091'
  secondary-container: '#571bc1'
  on-secondary-container: '#c4abff'
  tertiary: '#4edea3'
  on-tertiary: '#003824'
  tertiary-container: '#1bbd85'
  on-tertiary-container: '#00452e'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#acedff'
  primary-fixed-dim: '#4cd7f6'
  on-primary-fixed: '#001f26'
  on-primary-fixed-variant: '#004e5c'
  secondary-fixed: '#e9ddff'
  secondary-fixed-dim: '#d0bcff'
  on-secondary-fixed: '#23005c'
  on-secondary-fixed-variant: '#5516be'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#101419'
  on-background: '#e0e2ea'
  surface-variant: '#31353b'
typography:
  display:
    fontFamily: Geist
    fontSize: 2.25rem
    fontWeight: '600'
    lineHeight: 2.75rem
    letterSpacing: -0.025em
  headline-lg:
    fontFamily: Geist
    fontSize: 1.75rem
    fontWeight: '600'
    lineHeight: 2.25rem
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Geist
    fontSize: 1.375rem
    fontWeight: '600'
    lineHeight: 1.875rem
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Geist
    fontSize: 1.25rem
    fontWeight: '500'
    lineHeight: 1.75rem
    letterSpacing: -0.01em
  title-sm:
    fontFamily: Geist
    fontSize: 0.9375rem
    fontWeight: '500'
    lineHeight: 1.375rem
    letterSpacing: 0em
  body-lg:
    fontFamily: JetBrains Mono
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: 1.5rem
    letterSpacing: -0.01em
  body-md:
    fontFamily: JetBrains Mono
    fontSize: 0.8125rem
    fontWeight: '400'
    lineHeight: 1.375rem
    letterSpacing: -0.005em
  code-hash:
    fontFamily: JetBrains Mono
    fontSize: 0.75rem
    fontWeight: '500'
    lineHeight: 1.25rem
    letterSpacing: 0.025em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 0.6875rem
    fontWeight: '500'
    lineHeight: 1rem
    letterSpacing: 0.05em
  label-xs:
    fontFamily: JetBrains Mono
    fontSize: 0.625rem
    fontWeight: '600'
    lineHeight: 0.875rem
    letterSpacing: 0.08em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  space-2xs: 0.125rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-base: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
  space-2xl: 3rem
  inspector-rail: 24rem
  gutter-default: 1rem
  panel-gap: 0.75rem
---

## Brand & Style

This design system delivers an uncompromising, developer-grade forensic workspace engineered for zero-trust media provenance and C2PA Content Credentials inspection. The visual environment communicates surgical precision, computational integrity, and absolute verification. 

The aesthetic is anchored in an obsidian and dark-slate palette, elevated by sharp geometric alignment, hairline borders, and crystalline cryptographic status signals. Monospaced typography gives cryptographic primitives—hashes, certificates, byte alignments, and claim manifests—the prominence of primary evidence, while a stark headline typeface ensures clean navigational authority.

Subtle glassmorphic layering and high-density data panels evoke an instrumented terminal cockpit. The system balances high-density information architecture with disciplined spatial rhythm, giving security analysts, journalists, and engineers unwavering confidence in local verification outcomes.

## Colors

The palette operates on pure dark-mode calibration, utilizing an obsidian foundation (`#090D12`) to eliminate visual glare while maintaining deep dynamic contrast for evidentiary inspection.

- **Primary Cyan (`#06B6D4`):** Represents verified state logic, active inspection crosshairs, focus rings, and primary interactive surfaces.
- **Secondary Violet (`#8B5CF6`):** Governs cryptographic signing chains, certificate authority hierarchies, and assertion validation markers.
- **Tertiary Emerald (`#10B981`):** Applied exclusively to mathematically intact signature proofs, valid C2PA manifest matches, and tamper-free audit states.
- **Warning Amber (`#F59E0B`):** Highlights untrusted timestamp authorities, missing parent manifests, or unvalidated claims.
- **Destructive / Error Ruby (`#F43F5E`):** Surfaces hash mismatches, broken certificate revocation lists, and manipulated asset data.
- **Neutral Grayscale:** Transitions from deep background slate (`#090D12`) up through panel containers (`#0E141D`), elevated inspector surfaces (`#161F2C`), hair-line dividers (`#243247`), and high-readability foreground data layers (`#F1F5F9`).

## Typography

The typography pairings enforce visual triage between systemic navigation and raw forensic proof:

- **Geist** manages interface architecture, view controllers, section headers, and high-level analytical judgments. It balances technical restraint with neutral, modern legibility.
- **JetBrains Mono** powers all inspected metadata, raw assertion trees, JSON manifests, cryptographic hash representations, and system metric values. 

Use tabular numerical figures universally to preserve baseline grid alignment across changing byte sizes, time offsets, and SHA-256 strings. Hash values and binary representations should strictly use lowercase alphanumeric configurations with the `code-hash` level.

## Layout & Spacing

The layout operates on a 4px baseline micro-grid combined with a high-density, multi-pane workbench layout model.

- **Workbench Split Layout:** Standard desktop viewport features a fixed horizontal command bar (48px height), an unconstrained primary canvas for asset inspection with metadata overlays, and a docked inspector rail (`inspector-rail`: 24rem / 384px) for C2PA manifest hierarchy navigation.
- **Breakpoint Behavior:**
  - **Desktop (>= 1280px):** Simultaneous multi-panel layout. Asset preview, raw claim ledger, and signing chain tree remain visible side-by-side.
  - **Tablet (768px – 1279px):** Split-view pivots to a tabbed bottom drawer for the metadata inspector, reserving viewport height for file ingestion and canvas zoom.
  - **Mobile (< 768px):** Linear stacked layout. The canvas scales to a fixed 16:9 or 1:1 preview with cryptographic status cards pinned to an accordioned forensic sheet beneath.
- **Rhythm & Padding:** Dense data grids enforce `space-xs` (4px) to `space-sm` (8px) internal cell padding, preserving maximum viewport real estate for detailed technical inspection.

## Elevation & Depth

Depth in this design system is established through tonal stepping and subtle backdrops rather than theatrical drop shadows.

- **Base Tier (Ground):** Pure `#090D12`, zero blur, baseline canvas area.
- **Surface Tier (Panels & Rails):** Dark slate `#0E141D` with a crisp 1px border (`rgba(36, 50, 71, 0.7)`).
- **Float Tier (Flyouts, Popovers, Modals):** Translucent obsidian (`rgba(14, 20, 29, 0.85)`) coupled with a 12px background Gaussian blur and a direct 1px perimeter edge of `rgba(6, 182, 212, 0.25)` to signal active cryptographic verification context.
- **Shadow Profile:** Shadows are ultra-diffused and directional: `0 4px 20px -2px rgba(0, 0, 0, 0.65)`. No ambient colored glow is permitted unless explicitly indicating a status state (e.g., subtle 4px radial blur on an active cryptographic badge).

## Shapes

The design system enforces a precise, geometric shape language (`roundedness: 1`):

- **Default Element Radius:** `0.25rem` (4px) applied to buttons, input fields, badge containers, and raw metadata cards.
- **Panels & Sheet Modals:** `0.5rem` (8px) maximum corner radius on outer structural containers, preventing visual softness in an otherwise hardline technical tool.
- **Pills and Circles:** Restricted strictly to cryptographic verification indicator dots (status LEDs) and avatar certificate seals. Interactive controls must never be pill-shaped.

## Components

### Buttons
- **Primary:** Filled with cyan (`#06B6D4`), dark slate text (`#090D12`), weight 600, 4px corner radius. Hover shifts to `#22D3EE` with a 1px border glow.
- **Secondary / Ghost:** Transparent background with 1px border (`#243247`). Monospace text in `#94A3B8`. Hover transitions background to `rgba(255, 255, 255, 0.04)` and border to cyan.
- **Destructive:** Bordered in ruby (`#F43F5E`) with low-opacity ruby fill (`rgba(244, 63, 94, 0.1)`).

### Verification Badges & Status Chips
- Height of 22px, corner radius of 4px. Monospaced `label-xs` uppercase text.
- **Verified Trust Badge:** Bordered in `#10B981`, surface `rgba(16, 185, 129, 0.08)`, text `#34D399`, preceded by a 6px circular indicator dot.
- **Tampered / Invalid Badge:** Bordered in `#F43F5E`, surface `rgba(244, 63, 94, 0.08)`, text `#FB7185`.
- **Claim Pending Badge:** Bordered in `#8B5CF6`, surface `rgba(139, 92, 246, 0.08)`, text `#C4B5FD`.

### Metadata Key-Value Lists & Data Grids
- Rendered in alternating rows or clean hair-line divided rows. 
- Left column (Key): Monospace `label-sm` in slate gray (`#64748B`), right-aligned or fixed width.
- Right column (Value): Monospace `body-md` in light slate (`#F1F5F9`), supporting instant click-to-copy interactions with visual micro-feedback (cyan checkmark).

### Input Fields & Hash Inspect Bars
- Dark slate surface (`#0E141D`), 1px border in `#243247`. 
- Active focus invokes a solid 1px border in `#06B6D4` with a tight 2px outer ring glow (`rgba(6, 182, 212, 0.2)`).
- Input text uses `JetBrains Mono` with integrated trailing actions (e.g., clear, format JSON, copy hash).

### Provenance Tree Nodes (Custom Component)
- Hierarchical tree nodes illustrating parent/child manifests.
- Connected via 1px orthogonal lines (`#243247`).
- Active node is framed with a 1px `#06B6D4` outline and an internal dark gradient fill.

### Hex & Manifest Chunk Viewer (Custom Component)
- High-density monospaced code viewer supporting byte offsets in gutter, standard hex representation in center, and decoded ASCII on the right flank. 
- Zero outer margin, 100% width within inspector containers, selection highlighted in semi-transparent primary cyan (`rgba(6, 182, 212, 0.3)`).