import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Accueil · Mes aquariums',
    loadComponent: () => import('./pages/home/home').then((m) => m.HomePage),
  },
  {
    path: 'bacs',
    title: 'Bacs · Mes aquariums',
    loadComponent: () => import('./pages/tanks/tanks').then((m) => m.TanksPage),
  },
  {
    path: 'bacs/nouveau',
    title: 'Nouveau bac',
    loadComponent: () => import('./pages/tank-form/tank-form').then((m) => m.TankFormPage),
  },
  {
    path: 'bacs/:id/modifier',
    title: 'Modifier le bac',
    loadComponent: () => import('./pages/tank-form/tank-form').then((m) => m.TankFormPage),
  },
  {
    path: 'bacs/:id/taches/nouvelle',
    title: 'Nouvelle tâche',
    loadComponent: () => import('./pages/task-form/task-form').then((m) => m.TaskFormPage),
  },
  {
    path: 'bacs/:id/taches/:taskId',
    title: 'Modifier la tâche',
    loadComponent: () => import('./pages/task-form/task-form').then((m) => m.TaskFormPage),
  },
  {
    path: 'bacs/:id/habitants/:hid',
    title: 'Habitant',
    loadComponent: () => import('./pages/inhabitant/inhabitant').then((m) => m.InhabitantPage),
  },
  {
    path: 'bacs/:id',
    loadComponent: () => import('./pages/tank-detail/tank-detail').then((m) => m.TankDetailPage),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'population' },
      {
        path: 'population',
        title: 'Population',
        loadComponent: () => import('./pages/tank-detail/population').then((m) => m.PopulationTab),
      },
      {
        path: 'eau',
        title: 'Eau',
        loadComponent: () => import('./pages/tank-detail/water').then((m) => m.WaterTab),
      },
      {
        path: 'photos',
        title: 'Photos',
        loadComponent: () => import('./pages/tank-detail/photos').then((m) => m.PhotosTab),
      },
      {
        path: 'entretien',
        title: 'Entretien',
        loadComponent: () =>
          import('./pages/tank-detail/maintenance').then((m) => m.MaintenanceTab),
      },
    ],
  },
  {
    path: 'releve',
    title: 'Nouveau relevé',
    loadComponent: () => import('./pages/reading/reading').then((m) => m.ReadingPage),
  },
  {
    path: 'catalogue',
    title: 'Catalogue',
    loadComponent: () => import('./pages/catalog/catalog').then((m) => m.CatalogPage),
  },
  {
    path: 'catalogue/nouvelle',
    title: 'Nouvelle espèce',
    loadComponent: () => import('./pages/species-form/species-form').then((m) => m.SpeciesFormPage),
  },
  {
    path: 'catalogue/:id/modifier',
    title: 'Modifier la fiche',
    loadComponent: () => import('./pages/species-form/species-form').then((m) => m.SpeciesFormPage),
  },
  {
    path: 'catalogue/:id',
    title: 'Fiche espèce',
    loadComponent: () => import('./pages/species/species').then((m) => m.SpeciesPage),
  },
  {
    path: 'diagnostic',
    title: 'Diagnostic IA',
    loadComponent: () => import('./pages/diagnostic/diagnostic').then((m) => m.DiagnosticPage),
  },
  {
    path: 'import-ia',
    title: 'Importer depuis l’IA',
    loadComponent: () => import('./pages/ai-import/ai-import').then((m) => m.AiImportPage),
  },
  {
    path: 'materiel',
    title: 'Matériel',
    loadComponent: () => import('./pages/gear/gear').then((m) => m.GearPage),
  },
  {
    path: 'materiel/equipement/nouveau',
    title: 'Nouvel équipement',
    loadComponent: () => import('./pages/gear/gear-forms').then((m) => m.EquipmentFormPage),
  },
  {
    path: 'materiel/equipement/:id',
    title: 'Équipement',
    loadComponent: () => import('./pages/gear/gear-forms').then((m) => m.EquipmentFormPage),
  },
  {
    path: 'materiel/consommable/nouveau',
    title: 'Nouveau consommable',
    loadComponent: () => import('./pages/gear/gear-forms').then((m) => m.ConsumableFormPage),
  },
  {
    path: 'materiel/consommable/:id',
    title: 'Consommable',
    loadComponent: () => import('./pages/gear/gear-forms').then((m) => m.ConsumableFormPage),
  },
  {
    path: 'connexion',
    title: 'Connexion · Mes aquariums',
    loadComponent: () => import('./pages/account/login').then((m) => m.LoginPage),
  },
  {
    path: 'mentions-legales',
    title: 'Mentions légales',
    data: { doc: 'mentions' },
    loadComponent: () => import('./pages/legal/legal').then((m) => m.LegalPage),
  },
  {
    path: 'confidentialite',
    title: 'Politique de confidentialité',
    data: { doc: 'confidentialite' },
    loadComponent: () => import('./pages/legal/legal').then((m) => m.LegalPage),
  },
  {
    path: 'conditions',
    title: 'Conditions d’utilisation',
    data: { doc: 'conditions' },
    loadComponent: () => import('./pages/legal/legal').then((m) => m.LegalPage),
  },
  {
    path: 'reglages',
    title: 'Réglages',
    loadComponent: () => import('./pages/settings/settings').then((m) => m.SettingsPage),
  },
  { path: '**', redirectTo: '' },
];
