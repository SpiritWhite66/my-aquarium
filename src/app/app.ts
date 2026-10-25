import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AquariumStore } from './core/store';
import { ThemeService } from './core/theme';
import { BackupService } from './core/backup';
import { Icon } from './shared/icon';

/** Coquille : barre latérale sur ordinateur, barre d'onglets en bas sur mobile. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly store = inject(AquariumStore);
  // Instancié ici pour appliquer le thème dès le démarrage.
  private readonly theme = inject(ThemeService);
  // Demande la persistance du stockage dès le démarrage.
  private readonly backup = inject(BackupService);

  protected readonly nav = [
    { path: '/', label: 'Accueil', icon: 'home', exact: true },
    { path: '/bacs', label: 'Bacs', icon: 'tank', exact: false },
    { path: '/catalogue', label: 'Catalogue', icon: 'book', exact: false },
    { path: '/reglages', label: 'Réglages', icon: 'settings', exact: false },
  ];
}
