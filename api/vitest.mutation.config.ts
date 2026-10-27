// Tests de mutation : seulement les tests unitaires (rapides, sans base de données).
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['src/**/*.spec.ts'] } });
