/**
 * theme — unified design tokens and CSS variables for all pages.
 *
 * WHAT THIS MODULE IS: a pure function returning a <style> block containing
 * CSS custom properties and base styles. Every page can call `getThemeStyles()`
 * to inject the same design system.
 *
 * WHY IT IS TOKENIZED: spacing, radii, shadows, and surface levels are all
 * declared as custom properties up front, then consumed exclusively via var().
 * Consistent rhythm across sections reads as deliberate; repeated literals read
 * as unfinished.
 *
 * DESIGN SENSE: this follows the captain's design judgment — a 5-7 surface
 * tonal ladder rising from near-black, tinted toward cyan/emerald for data,
 * with exactly one luminous accent at high saturation. Fluid typography with
 * clamp(), tight negative tracking on display sizes, generous line-height on
 * body copy. Grid-first layout. Fully rounded geometry (999px pills, 50%
 * circles). Never a flat white page, never indigo-on-white, never a purple
 * gradient.
 */

/**
 * Get the complete theme CSS as a string (for inline <style> injection).
 *
 * @returns {string} The theme CSS block.
 */
export function getThemeStyles() {
  return `
/* ============================================================
   DESIGN TOKENS — TONAL LADDER & SEMANTIC COLORS
   ============================================================ */

:root {
  color-scheme: light dark;
  
  /* 5-layer surface ladder: near-black → mid-gray, tinted toward cyan for data */
  --surface-0: #05070C;   /* 3% lightness, deepest */
  --surface-1: #0A0D12;   /* 6%, main background */
  --surface-2: #0F131C;   /* 9%, cards */
  --surface-3: #161D2B;   /* 12%, elevated elements */
  --surface-4: #1E2636;   /* 15%, brightest surface */
  
  /* Ink tones */
  --ink: #e8e8f0;         /* primary text */
  --ink-soft: #a8a8bb;    /* secondary text */
  --ink-faint: #767688;   /* hint text */
  --line: #2b2b36;        /* borders & dividers */
  
  /* Luminous accent — high-saturation cyan for data theme */
  --accent: #38BDF8;
  --accent-dim: #1e7a9f;
  --accent-glow: rgba(56, 189, 248, 0.15);
  
  /* Semantic states */
  --warn: #e0b850;
  --warn-bg: #302916;
  --warn-dim: #b08419;
  
  --bad: #ff8b8b;
  --bad-bg: #331c1c;
  --bad-dim: #d66;
  
  --good: #6EE7B7;        /* emerald, for explicit success only */
  --good-bg: #1a3328;
  --good-dim: #4aba8a;
  
  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 2px 8px rgba(0, 0, 0, 0.4), 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-lg: 0 6px 20px rgba(0, 0, 0, 0.5), 0 2px 4px rgba(0, 0, 0, 0.4);
  
  /* Spacing tokens */
  --space-xs: 0.25rem;
  --space-sm: 0.5rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;
  --space-xl: 2rem;
  --space-2xl: 3rem;
  
  /* Radius tokens — fully rounded geometry */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 999px;   /* pills */
  --radius-circle: 50%;   /* avatars, icons */
  
  /* Font families */
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC",
               "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, "Courier New", monospace;
  
  /* Fluid typography with clamp() */
  --text-xs: clamp(0.72rem, 0.7rem + 0.1vw, 0.78rem);
  --text-sm: clamp(0.82rem, 0.8rem + 0.1vw, 0.9rem);
  --text-base: clamp(0.95rem, 0.93rem + 0.1vw, 1rem);
  --text-lg: clamp(1.1rem, 1.05rem + 0.25vw, 1.25rem);
  --text-xl: clamp(1.35rem, 1.25rem + 0.5vw, 1.75rem);
  
  /* Line heights */
  --lh-tight: 1.35;
  --lh-base: 1.65;
  --lh-loose: 1.85;
  
  /* Letter spacing */
  --tracking-tight: -0.02em;
  --tracking-base: 0;
  --tracking-wide: 0.05em;
  --tracking-wider: 0.12em;
}

@media (prefers-color-scheme: light) {
  :root {
    --surface-0: #fafbfc;
    --surface-1: #f6f7fb;
    --surface-2: #ffffff;
    --surface-3: #f1f2f6;
    --surface-4: #e8e9ef;
    
    --ink: #1b1b20;
    --ink-soft: #5a5a68;
    --ink-faint: #8a8a99;
    --line: #e2e3ec;
    
    --accent: #2d93cc;
    --accent-dim: #5ab3e8;
    --accent-glow: rgba(45, 147, 204, 0.12);
    
    --warn: #b08419;
    --warn-bg: #fdf6e3;
    --warn-dim: #d4a645;
    
    --bad: #b02a2a;
    --bad-bg: #fdeeee;
    --bad-dim: #d65656;
    
    --good: #28a876;
    --good-bg: #e8f8f2;
    --good-dim: #4aba8a;
    
    --shadow-sm: 0 1px 2px rgba(20, 20, 40, 0.05);
    --shadow-md: 0 2px 8px rgba(20, 20, 40, 0.08), 0 1px 2px rgba(20, 20, 40, 0.04);
    --shadow-lg: 0 6px 20px rgba(20, 20, 40, 0.12), 0 2px 4px rgba(20, 20, 40, 0.06);
  }
}

/* ============================================================
   BASE STYLES
   ============================================================ */

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: var(--space-xl) var(--space-lg) 7rem;
  background: var(--surface-1);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: var(--lh-base);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.wrap {
  max-width: 72rem;
  margin: 0 auto;
}

/* ============================================================
   TYPOGRAPHY
   ============================================================ */

h1 {
  font-size: var(--text-xl);
  font-weight: 700;
  line-height: var(--lh-tight);
  letter-spacing: var(--tracking-tight);
  margin: 0;
}

h2 {
  font-size: var(--text-sm);
  font-weight: 600;
  line-height: var(--lh-base);
  letter-spacing: var(--tracking-wider);
  text-transform: uppercase;
  color: var(--ink-faint);
  margin: var(--space-2xl) 0 var(--space-md);
}

h3 {
  font-size: var(--text-base);
  font-weight: 600;
  line-height: var(--lh-base);
  margin: 0 0 var(--space-sm);
}

p {
  margin: var(--space-sm) 0;
}

.muted {
  color: var(--ink-soft);
  font-size: var(--text-sm);
}

code, pre, .mono {
  font-family: var(--font-mono);
  font-size: 0.86em;
}

code {
  background: var(--surface-3);
  border-radius: var(--radius-sm);
  padding: 0.05em 0.35em;
}

pre {
  margin: var(--space-md) 0 0;
  padding: var(--space-md);
  overflow: auto;
  max-height: 24rem;
  background: var(--surface-0);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  line-height: 1.5;
}

/* ============================================================
   LAYOUT PRIMITIVES — GRID FIRST
   ============================================================ */

.page-grid {
  display: grid;
  grid-template-columns: minmax(16rem, 20rem) 1fr;
  gap: var(--space-xl);
  max-width: 90rem;
  margin: 0 auto;
}

.card-grid {
  display: grid;
  gap: var(--space-lg);
  grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
}

.row-grid {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-sm) var(--space-lg);
  margin: 0;
}

/* ============================================================
   COMPONENTS — TOKENIZED
   ============================================================ */

header.top {
  padding-bottom: var(--space-lg);
  border-bottom: 1px solid var(--line);
}

.claim {
  margin: var(--space-lg) 0 0;
  padding: var(--space-lg) var(--space-md);
  border-left: 3px solid var(--warn);
  border-radius: var(--radius-md);
  background: var(--warn-bg);
  color: var(--ink);
}

.claim strong {
  display: block;
  margin-bottom: var(--space-xs);
}

.claim .literals {
  color: var(--ink-soft);
  font-size: var(--text-sm);
}

.panel {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: var(--space-lg) var(--space-md);
  box-shadow: var(--shadow-md);
}

dl.rows {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-sm) var(--space-lg);
  margin: 0;
}

dl.rows dt {
  color: var(--ink-soft);
  font-size: var(--text-sm);
}

dl.rows dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.card {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: var(--space-lg) var(--space-md);
  box-shadow: var(--shadow-md);
  transition: box-shadow 0.15s, border-color 0.15s;
}

.card:hover {
  box-shadow: var(--shadow-lg);
  border-color: var(--accent-dim);
}

.card.refused {
  border-color: var(--bad);
  background: var(--bad-bg);
}

.card.success {
  border-color: var(--good);
  background: var(--good-bg);
}

.badge {
  display: inline-block;
  margin-left: var(--space-sm);
  padding: 0 var(--space-sm);
  border: 1px solid var(--line);
  border-radius: var(--radius-full);  /* pill */
  font-size: var(--text-xs);
  color: var(--ink-soft);
  vertical-align: 1px;
}

.badge.warn {
  border-color: var(--warn);
  color: var(--warn);
  background: var(--warn-bg);
}

.badge.bad {
  border-color: var(--bad);
  color: var(--bad);
  background: var(--bad-bg);
}

.badge.good {
  border-color: var(--good);
  color: var(--good);
  background: var(--good-bg);
}

ul.codes {
  list-style: none;
  padding: 0;
  margin: var(--space-sm) 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

ul.codes > li {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 0.05rem var(--space-sm);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--ink-soft);
}

ul.plain {
  margin: 0;
  padding-left: var(--space-lg);
}

ul.plain > li {
  margin: var(--space-xs) 0;
}

details {
  margin-top: var(--space-md);
}

summary {
  cursor: pointer;
  color: var(--ink-faint);
  font-size: var(--text-sm);
  user-select: none;
}

summary:hover {
  color: var(--accent);
}

footer {
  position: fixed;
  inset: auto 0 0 0;
  padding: var(--space-md) var(--space-lg);
  background: var(--surface-2);
  border-top: 1px solid var(--line);
  color: var(--ink-soft);
  font-size: var(--text-xs);
  z-index: 100;
  backdrop-filter: blur(8px);
}

footer .wrap {
  max-width: 72rem;
  margin: 0 auto;
}

/* ============================================================
   BUTTONS — PILL SHAPE
   ============================================================ */

.btn {
  display: inline-block;
  padding: var(--space-sm) var(--space-lg);
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  font-weight: 600;
  font-family: var(--font-sans);
  border: none;
  cursor: pointer;
  transition: all 0.15s;
  text-decoration: none;
}

.btn-primary {
  background: var(--accent);
  color: var(--surface-0);
}

.btn-primary:hover {
  background: var(--accent-dim);
  box-shadow: var(--shadow-lg);
}

.btn-secondary {
  background: var(--surface-3);
  color: var(--ink);
  border: 1px solid var(--line);
}

.btn-secondary:hover {
  background: var(--surface-4);
  border-color: var(--accent-dim);
}

/* ============================================================
   AVATAR & ICON WELLS — CIRCLE
   ============================================================ */

.avatar {
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-circle);
  background: var(--surface-3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--accent);
}

.icon-well {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: var(--radius-circle);
  background: var(--accent-glow);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
}

/* ============================================================
   UTILITY CLASSES
   ============================================================ */

.mt-0 { margin-top: 0 !important; }
.mt-xs { margin-top: var(--space-xs) !important; }
.mt-sm { margin-top: var(--space-sm) !important; }
.mt-md { margin-top: var(--space-md) !important; }
.mt-lg { margin-top: var(--space-lg) !important; }
.mt-xl { margin-top: var(--space-xl) !important; }

.mb-0 { margin-bottom: 0 !important; }
.mb-xs { margin-bottom: var(--space-xs) !important; }
.mb-sm { margin-bottom: var(--space-sm) !important; }
.mb-md { margin-bottom: var(--space-md) !important; }
.mb-lg { margin-bottom: var(--space-lg) !important; }
.mb-xl { margin-bottom: var(--space-xl) !important; }

.text-center { text-align: center; }
.text-right { text-align: right; }

.font-mono { font-family: var(--font-mono) !important; }
.font-sans { font-family: var(--font-sans) !important; }
`.trim()
}
