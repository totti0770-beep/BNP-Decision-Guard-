import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7f5',
          100: '#d5ece7',
          500: '#0f766e',
          600: '#0d655e',
          700: '#0b544e',
          900: '#083f3a',
        },
      },
    },
  },
  plugins: [],
};

export default config;
