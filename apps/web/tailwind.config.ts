import type { Config } from 'tailwindcss';

/** Maps a CSS-variable RGB triplet into a Tailwind colour that accepts `/opacity`. */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        elevated: token('elevated'),
        sunken: token('sunken'),
        border: token('border'),
        'border-strong': token('border-strong'),
        text: token('text'),
        muted: token('text-muted'),
        subtle: token('text-subtle'),
        primary: {
          DEFAULT: token('primary'),
          hover: token('primary-hover'),
          fg: token('primary-fg'),
          soft: token('primary-soft'),
        },
        success: { DEFAULT: token('success'), soft: token('success-soft') },
        warning: { DEFAULT: token('warning'), soft: token('warning-soft') },
        danger: { DEFAULT: token('danger'), soft: token('danger-soft') },
        info: { DEFAULT: token('info'), soft: token('info-soft') },
      },
      /**
       * Radius encodes hierarchy rather than a single rounded look:
       * controls are tighter than the containers that hold them.
       */
      borderRadius: {
        control: '6px',
        card: '10px',
        panel: '14px',
      },
      /** Type scale with line-height and tracking baked in per step. */
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.02em' }],
        xs: ['0.75rem', { lineHeight: '1.125rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.875rem', { lineHeight: '1.5rem' }],
        lg: ['1rem', { lineHeight: '1.5rem', letterSpacing: '-0.006em' }],
        xl: ['1.125rem', { lineHeight: '1.625rem', letterSpacing: '-0.012em' }],
        '2xl': ['1.375rem', { lineHeight: '1.875rem', letterSpacing: '-0.018em' }],
        '3xl': ['1.75rem', { lineHeight: '2.125rem', letterSpacing: '-0.022em' }],
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'slide-in-left': 'slide-in-left 220ms cubic-bezier(0.32, 0.72, 0, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
