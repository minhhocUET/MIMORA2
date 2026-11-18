/**
 * Centralized MIMORA semantic design tokens (single source of truth for UI documentation and tests).
 * Visual values mirror CSS custom properties in src/index.css.
 */
export const MIMORA_TOKENS = {
  colors: {
    primary: {
      hex: '#1a6f6b',
      hover: '#145a57',
      surface: '#e8f4f1',
      cssVar: '--mimora-primary',
    },
    secondary: {
      hex: '#5a4c8c',
      hover: '#493d75',
      surface: '#f1eef9',
      cssVar: '--mimora-secondary',
    },
    accent: {
      hex: '#b84f3b',
      hover: '#9b3f2e',
      surface: '#fdf0eb',
      cssVar: '--mimora-accent',
    },
    mutedYellowSurface: {
      hex: '#fdf6de',
      cssVar: '--mimora-surface-butter',
    },
    background: {
      hex: '#faf8f4',
      cssVar: '--mimora-bg',
    },
    surface: {
      hex: '#ffffff',
      subtle: '#f3efe8',
      cssVar: '--mimora-surface',
    },
    text: {
      hex: '#1e292b',
      cssVar: '--mimora-text',
    },
    muted: {
      hex: '#526165',
      cssVar: '--mimora-muted',
    },
    border: {
      hex: '#dfd9ce',
      strong: '#c5bdb0',
      cssVar: '--mimora-border',
    },
    success: {
      hex: '#1f6e4e',
      bg: '#e7f5ee',
      border: '#b6decb',
      cssVar: '--mimora-success',
    },
    warning: {
      hex: '#8f5c0c',
      bg: '#fdf5dc',
      border: '#edd79a',
      cssVar: '--mimora-warning',
    },
    danger: {
      hex: '#b43232',
      bg: '#fdecec',
      border: '#f4c2c2',
      cssVar: '--mimora-danger',
    },
    focus: {
      hex: '#12585c',
      cssVar: '--mimora-focus',
    },
  },
  typography: {
    sans: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  radii: {
    sm: '0.5rem',
    md: '0.875rem',
    lg: '1.25rem',
    xl: '1.75rem',
  },
  spacing: {
    touchTargetMinPx: 44,
    cardElevationShadow: '0 2px 10px -2px rgba(30, 41, 43, 0.06)',
  },
  transitions: {
    routineMs: 160,
    easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
  },
} as const;

export type MimoraTokenSpec = typeof MIMORA_TOKENS;
