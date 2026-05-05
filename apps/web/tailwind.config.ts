import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#1a1a2e',
          raised: '#16213e',
          overlay: '#0f3460',
        },
        accent: {
          DEFAULT: '#e94560',
          hover: '#c73652',
        },
      },
    },
  },
  plugins: [],
} satisfies Config
