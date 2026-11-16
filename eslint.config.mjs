// ESLint (flat config) para todo el proyecto: frontend React/Vite y backend Node/Express.
// Documentación: docs/eslint.md
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

const isProd = process.env.NODE_ENV === 'production';

export default [
  // ---------- Archivos que no se analizan (generados, dependencias, datos) ----------
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-ssr/**',
      '**/dev-dist/**',
      '**/coverage/**',
      'frontend/public/**', // assets estáticos y theme-init.js (script clásico mínimo)
      'backend/uploads/**',
      'backend/.tesseract-cache/**',
      '.claude/**', // skills de terceros
    ],
  },

  // ---------- Base para todo el código ----------
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: { '@stylistic': stylistic },
    rules: {
      // Formato mínimo para que el autofix de "curly" deje bloques legibles: if (x) { return; }
      '@stylistic/block-spacing': ['error', 'always'],
      '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
      '@stylistic/no-trailing-spaces': 'error',
      // Errores potenciales
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', ignoreRestSiblings: true, caughtErrors: 'none' }],
      'no-duplicate-imports': 'error',
      'no-template-curly-in-string': 'error',
      'no-self-compare': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unreachable-loop': 'error',
      'no-promise-executor-return': 'error',
      'no-constructor-return': 'error',
      'require-atomic-updates': 'off', // falsos positivos con req/res de Express; la concurrencia se maneja con transacciones
      // Buenas prácticas
      eqeqeq: ['error', 'always', { null: 'ignore' }], // `x == null` cubre null y undefined a propósito
      curly: ['error', 'all'],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      'no-throw-literal': 'error',
      'prefer-promise-reject-errors': 'error',
      'no-return-assign': ['error', 'except-parens'],
      'no-useless-return': 'error',
      'no-useless-rename': 'error',
      'no-useless-concat': 'error',
      'no-else-return': ['error', { allowElseIf: false }],
      'object-shorthand': ['error', 'properties'],
      'prefer-template': 'error',
      'no-implicit-coercion': ['error', { allow: ['!!'] }],
      'no-new-wrappers': 'error',
      'no-param-reassign': ['error', { props: false }],
      'no-lonely-if': 'error',
      'dot-notation': 'error',
    },
  },

  // ---------- Frontend: React (navegador) ----------
  {
    files: ['frontend/src/**/*.{js,jsx}'],
    ignores: ['frontend/src/sw.js', 'frontend/src/entry-prerender.jsx'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: '18.3' } },
    plugins: { react, 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'error',
      'react/jsx-key': ['error', { checkFragmentShorthand: true, warnOnDuplicates: true }],
      'react/jsx-no-useless-fragment': ['error', { allowExpressions: true }],
      'react/self-closing-comp': 'error',
      'react/jsx-boolean-value': ['error', 'never'],
      'react/jsx-curly-brace-presence': ['error', { props: 'never', children: 'never' }],
      'react/no-array-index-key': 'warn',
      // React 18 solo reconoce el atributo en minúsculas (fetchPriority llega recién en React 19)
      'react/no-unknown-property': ['error', { ignore: ['fetchpriority'] }],
      'react/jsx-no-target-blank': 'error',
      // El proyecto documenta props con JSDoc; PropTypes duplicaría esa información en runtime
      'react/prop-types': 'off',
      // Fast Refresh de Vite: un archivo de componente no debería exportar otras cosas
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // En el navegador, console solo para advertencias y errores reales
      'no-console': [isProd ? 'error' : 'warn', { allow: ['warn', 'error'] }],
    },
  },

  // ---------- Frontend: service worker ----------
  {
    files: ['frontend/src/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },

  // ---------- Frontend: prerender SSR (se ejecuta en Node durante el build) ----------
  {
    files: ['frontend/src/entry-prerender.jsx'],
    languageOptions: { globals: { ...globals.node }, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { react },
    rules: { ...react.configs['jsx-runtime'].rules, 'react/jsx-uses-vars': 'error' },
  },

  // ---------- Node: backend, scripts, pruebas y archivos de configuración ----------
  {
    files: [
      'backend/**/*.js',
      'frontend/scripts/**/*.mjs',
      'frontend/test/**/*.mjs',
      'frontend/*.config.js',
      '*.config.mjs',
    ],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // El backend usa console como logger del proceso (stdout/stderr del servidor) y los scripts informan progreso
      'no-console': 'off',
    },
  },
];
