import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig).catch((err: unknown) => {
  // eslint-disable-next-line no-console -- l'application n'a pas démarré : rien d'autre pour signaler l'erreur
  console.error(err);
});
