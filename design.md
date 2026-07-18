# Design System — Studio Daï Oakes Admin

Internal admin tool + public booking page for Studio Daï Oakes (Daiane Oakes Body Therapist — Women's Recovery & Clinical Pilates, Rotterdam).

Branding sourced directly from the live site (daianeoakes.com / studiodaioakes.com) via design audit — colors, fonts and logo below are the real brand, not invented.

## Brand
- Business: Studio Daï Oakes — Women's Recovery & Clinical Pilates
- Legal entity: Daiane Oakes Body Therapist
- KVK: 75105659 | VAT: NL002476652B29 | IBAN: NL93 ABNA 0864 1372 57
- Address: Bergstraat 46B, Rotterdam
- Public site: daianeoakes.com
- Logo: `packages/web/public/brand/logo.png` — "STUDIO" (white/glow) + "DAÏ OAKES" (gold, art-deco serif) + "WOMEN'S RECOVERY & CLINICAL PILATES" tagline. Transparent background — must sit on a dark teal panel to be legible (mirrors how the real site displays it).

## Colors (extracted from live site)
- Deep teal (primary dark / header/sidebar): `#2E5252`
- Copper/terracotta (accent, CTAs): `#AE633F`
- Bronze/brown (secondary accent): `#955F27`
- Gold (highlight, logo, dividers): `#D1C06F`
- Tan/beige (muted accent): `#BA9268`
- Cream (page background): `#F2ECE4`
- Beige (card/section alt background): `#EBDFCF`
- Text dark: `#1F2B28`
- Text muted: `#6B6259`

## Typography (matches live site)
- Display / headings / brand wordmark: **Cinzel** (serif, all-caps, elegant, wide tracking)
- Elegant accents / italic subheads: **Cormorant Garamond** (italic for taglines, quotes)
- Body / UI text: **Jost** (light geometric sans — closest free match to the site's Futura/Avenir Light)

## Layout
- Sidebar / header bands: deep teal `#2E5252` background, gold/cream text, logo displayed on this panel
- Content background: cream `#F2ECE4`
- Cards: white or beige `#EBDFCF`, soft shadow, 10px radius (site uses fairly square corners, not heavily rounded)
- CTAs / primary buttons: copper `#AE633F` background, cream text, uppercase tracking-wide label (mirrors site's "CHECK NOW" button style)
- Dividers/accents: thin gold `#D1C06F` rule
- Status pills: success (paid) muted teal-green, warning (pending) bronze, danger (overdue) deep terracotta

## PDF Invoice
- Header band: deep teal background strip with logo + "INVOICE" in Cinzel
- Gold divider rule under header
- Body: Jost-style sans (Helvetica as PDF-safe fallback, matches the light geometric feel)
- Totals block emphasized in copper
- Footer: tagline "Women's Recovery & Clinical Pilates" in small caps + payment terms

## Motion
- Minimal, utilitarian — clarity over flash. Subtle fade-in on page load only.

## Language
- Interface: English. Invoices: English with Dutch fiscal fields (BTW, KVK) as legally required.
