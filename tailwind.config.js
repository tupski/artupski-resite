/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Tokens are sourced from docs/design/UI-SPEC.md section 3.1.
        // Channel values (R G B) come from src/styles/tokens.css so that
        // light/dark can be swapped via the `.dark` class without duplicating
        // hex values across components.
        base: 'rgb(var(--bg-base) / <alpha-value>)',
        surface: 'rgb(var(--bg-surface) / <alpha-value>)',
        'surface-elevated': 'rgb(var(--bg-surface-elevated) / <alpha-value>)',
        'border-subtle': 'rgb(var(--border-subtle) / <alpha-value>)',
        'border-focus': 'rgb(var(--border-focus) / <alpha-value>)',
        'text-primary': 'rgb(var(--text-primary) / <alpha-value>)',
        'text-secondary': 'rgb(var(--text-secondary) / <alpha-value>)',
        'text-muted': 'rgb(var(--text-muted) / <alpha-value>)',
        brand: 'rgb(var(--accent-brand) / <alpha-value>)',
        success: 'rgb(var(--accent-success) / <alpha-value>)',
        warning: 'rgb(var(--accent-warning) / <alpha-value>)',
        danger: 'rgb(var(--accent-danger) / <alpha-value>)',
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Consolas', 'monospace'],
      },
      fontSize: {
        // UI-SPEC section 3.2 type scale.
        display: ['20px', { lineHeight: '28px', fontWeight: '600' }],
        heading: ['16px', { lineHeight: '24px', fontWeight: '600' }],
        body: ['13px', { lineHeight: '20px', fontWeight: '400' }],
        caption: ['11px', { lineHeight: '16px', fontWeight: '500' }],
        code: ['12px', { lineHeight: '18px', fontWeight: '400' }],
      },
      borderRadius: {
        // Dense desktop tooling: small, consistent radii.
        sm: '4px',
        DEFAULT: '6px',
        md: '6px',
        lg: '8px',
      },
    },
  },
  plugins: [],
};
