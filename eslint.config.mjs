import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'warn'
    }
  },
  {
    ignores: ['out', 'dist', 'dist_build', 'release', '_cleanup_backup', 'node_modules', '*.config.*', 'scripts', 'index.js', '**/win-unpacked/**', '**/*.asar', '**/*.blockmap']
  }
)
