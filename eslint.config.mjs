// @ts-check
import eslint from '@eslint/js';
import angular from 'angular-eslint';
import { recommended as commentsRecommended } from '@eslint-community/eslint-plugin-eslint-comments/configs';
import security from 'eslint-plugin-security';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'reports/**',
      'playwright-report/**',
      'test-results/**',
      '.angular/**',
      '.stryker-tmp/**',
      'public/**',
      'ai/**',
    ],
  },
  {
    files: ['src/**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      ...angular.configs.tsRecommended,
      security.configs.recommended,
      commentsRecommended,
    ],
    processor: angular.processInlineTemplates,
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.app.json', './tsconfig.spec.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // `texte || undefined` : une chaîne ou un booléen vide/faux doit bien devenir « absent ».
      '@typescript-eslint/prefer-nullish-coalescing': [
        'error',
        { ignorePrimitives: { string: true, boolean: true } },
      ],
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Désactivée : son correctif remplace `as HTMLSelectElement` par `!`, ce qui change le type et casse la compilation.
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
      // Désactivée : on ne peut pas distinguer obj[clé] dangereux et bénin (faux positifs en masse
      // sur des tableaux et des index typés). L'injection est couverte par le typage strict et CodeQL.
      'security/detect-object-injection': 'off',
      // Toute désactivation d'une règle doit être justifiée et ciblée.
      '@eslint-community/eslint-comments/require-description': 'error',
      '@eslint-community/eslint-comments/disable-enable-pair': 'error',
      '@eslint-community/eslint-comments/no-unlimited-disable': 'error',
    },
  },
  {
    files: ['src/**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
    rules: {
      // `x != null` est la forme voulue pour « ni null ni undefined ».
      '@angular-eslint/template/eqeqeq': ['error', { allowNullOrUndefined: true }],
    },
  },
  {
    // Tests de bout en bout (Playwright) et scripts : mêmes règles, avec leur propre configuration TypeScript.
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      security.configs.recommended,
      commentsRecommended,
    ],
    languageOptions: {
      parserOptions: { project: ['./e2e/tsconfig.json'], tsconfigRootDir: import.meta.dirname },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@eslint-community/eslint-comments/require-description': 'error',
      'security/detect-object-injection': 'off',
    },
  },
  {
    // Les tests ont besoin de souplesse (simulacres, accès aux membres privés).
    files: ['src/**/*.spec.ts', 'src/**/*.testing.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
      // Dans les tests, `JSON.parse`, les simulacres (`vi.spyOn`, `vi.fn`) et les doubles partiels renvoient
      // `any` par nature : typer chacun n'apporterait pas de sécurité, seulement du bruit.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // Fonctions asynchrones sans `await` : imposées par les signatures attendues (démarrage, hooks).
      '@typescript-eslint/require-await': 'off',
      // Faux `navigator`, fausse classe `Notification`, `{ ...navigator, canShare }` : les simulacres reproduisent
      // volontairement des objets du navigateur.
      '@typescript-eslint/no-misused-spread': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      // `() => expect(...)` : forme concise courante avec `vi.waitFor`.
      '@typescript-eslint/no-confusing-void-expression': 'off',
    },
  },
);
