/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        sidebar: {
          bg: '#1e1e2e',
          hover: '#2a2a3e',
          active: '#3a3a5e',
          text: '#cdd6f4',
          muted: '#6c7086'
        },
        topbar: {
          bg: '#181825',
          border: '#313244'
        },
        workspace: {
          bg: '#11111b'
        },
        accent: {
          DEFAULT: '#89b4fa',
          hover: '#74c7ec'
        },
        success: '#a6e3a1',
        warning: '#f9e2af',
        error: '#f38ba8'
      }
    }
  },
  plugins: []
}
