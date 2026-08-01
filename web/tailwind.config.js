/** @type {import('tailwindcss').Config} */
// Paleta mapeada a variables CSS del mockup (soporta tema claro/oscuro vía [data-theme])
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        surface2: 'var(--surface2)',
        border: 'var(--border)',
        txt: 'var(--text)',
        txt2: 'var(--text2)',
        accent: 'var(--accent)',
        'accent-soft': 'var(--accent-soft)',
        ok: 'var(--ok)',
        warn: 'var(--warn)',
        'warn-soft': 'var(--warn-soft)',
        err: 'var(--err)',
        'err-soft': 'var(--err-soft)',
        info: 'var(--info)',
        'info-soft': 'var(--info-soft)',
      },
      borderRadius: { card: '14px' },
      boxShadow: { card: 'var(--shadow)' },
    },
  },
  plugins: [],
};
