// Configuration vitest simple (sans compilateur Angular) pour les tests de mutation :
// elle ne charge que les tests des modules qui n'ont pas besoin de l'interface, ce qui les rend très rapides.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { target: 'es2022' },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test-setup.mutation.ts'],
    include: ['src/app/core/**/*.spec.ts'],
  },
});
