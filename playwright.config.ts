import { defineConfig, devices } from '@playwright/test';

// Tests de bout en bout sur l'appli compilée (npm run build), servie comme sur GitHub Pages.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4370',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'bureau', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    // Proche de Safari iOS. À la demande seulement (E2E_WEBKIT=1) : demande des paquets système.
    ...(process.env['E2E_WEBKIT'] ? [{ name: 'webkit', use: { ...devices['iPhone 15'] } }] : []),
  ],
  webServer: { command: 'node e2e/serve.mjs', url: 'http://localhost:4370', reuseExistingServer: false },
});
