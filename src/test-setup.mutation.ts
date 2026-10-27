// Initialise Angular pour les tests lancés avec vitest seul (sans le compilateur du CLI) :
// les composants et services sont compilés à la volée (JIT).
import '@angular/compiler';
import { getTestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';

getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting(), { teardown: { destroyAfterEach: true } });
