import type { ElementRef } from '@angular/core';
import { ChangeDetectionStrategy, Component, inject, viewChild } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AquariumStore } from './core/store';
import { ThemeService } from './core/theme';
import { BackupService } from './core/backup';
import { NotificationService } from './core/notifications';
import { ErrorReport } from './core/error-report';
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
  protected readonly errors = inject(ErrorReport);
  // Instancié ici pour appliquer le thème dès le démarrage.
  private readonly theme = inject(ThemeService);
  // Demande la persistance du stockage dès le démarrage.
  private readonly backup = inject(BackupService);
  // Vérifie les rappels du jour à l'ouverture.
  private readonly notifications = inject(NotificationService);

  private readonly main = viewChild<ElementRef<HTMLElement>>('main');
  private navigations = 0;

  constructor() {
    // Après un changement de page, le focus passe au contenu : un lecteur d'écran annonce la nouvelle page.
    inject(Router).events.subscribe((e) => {
      if (e instanceof NavigationEnd && this.navigations++ > 0)
        this.main()?.nativeElement.focus({ preventScroll: true });
    });
  }

  protected skipToContent(e: Event): void {
    e.preventDefault();
    this.main()?.nativeElement.focus();
  }

  protected readonly nav = [
    { path: '/', label: 'Accueil', icon: 'home', exact: true },
    { path: '/bacs', label: 'Bacs', icon: 'tank', exact: false },
    { path: '/catalogue', label: 'Catalogue', icon: 'book', exact: false },
    { path: '/materiel', label: 'Matériel', icon: 'tool', exact: false },
    { path: '/reglages', label: 'Réglages', icon: 'settings', exact: false },
  ];
}
