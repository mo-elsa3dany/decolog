// tailwind.config.cjs
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base: '#05070B',
          elevated: '#0B0F14',
          muted: '#121823',
        },
        primary: {
          DEFAULT: '#00E5FF',
        },
        state: {
          success: '#2AFF8F',
          warning: '#FFB020',
          error: '#FF3B30',
        },
        text: {
          primary: '#F5F7FA',
          secondary: '#9CA3AF',
          muted: '#6B7280',
        },
        border: {
          subtle: '#1F2933',
          strong: '#374151',
        },
      },
      fontFamily: {
        ui: ['system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 12px 24px rgba(0, 0, 0, 0.35)',
      },
      borderRadius: {
        card: '12px',
      },
      maxWidth: {
        screen: '480px',
      },
    },
  },
  plugins: [],
};
