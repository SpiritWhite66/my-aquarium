// Configuration vitest simple (sans compilateur Angular) pour les tests de mutation :
// elle ne charge que les tests des modules purs, qui s'exécutent en quelques millisecondes.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/app/core/**/*.spec.ts'],
    exclude: ['src/app/core/store.spec.ts', 'src/app/core/notifications.spec.ts', 'src/app/core/data/**'],
  },
});
