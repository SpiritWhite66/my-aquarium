import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AquariumStore } from '../../core/store';
import { PhotoStore } from '../../core/stores/photo.store';
import { CareStore } from '../../core/stores/care.store';
import { PrefsStore } from '../../core/stores/prefs.store';
import { ThemeService, type ThemeChoice } from '../../core/theme';
import { TANK_TYPES, fmtShortDate } from '../../core/labels';
import { Icon } from '../../shared/icon';
import { BackupService, fmtBytes } from '../../core/backup';
import { tasksToIcs } from '../../core/insights';
import { NotificationService } from '../../core/notifications';
import type { NotificationPrefs } from '../../core/reminders';
import { BackupRepo } from '../../core/data/backup.repo';
import { CareRepo } from '../../core/data/care.repo';
import { PrefsRepo } from '../../core/data/prefs.repo';
import { RefSyncService } from '../../core/ref-sync';
import { API_URL } from '../../core/api-config';
import { AuthService } from '../../core/auth';
import { SyncService } from '../../core/sync';
import { PushService } from '../../core/push';
import { DiagLog } from '../../core/diag';
import { AQUARIUM_DB, type SyncMeta } from '../../core/db';
import { readPref } from '../../core/local-prefs';

@Component({
  selector: 'app-settings',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    section { display: flex; flex-direction: column; gap: 10px; }
    .it { display: flex; align-items: center; gap: 12px; padding: 12px 14px; min-height: 60px; color: inherit; text-decoration: none; }
    .it + .it { border-top: 1px solid var(--ln); }
    a.it:hover { background: var(--sf2); color: inherit; }
    .ic { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; flex: none; background: var(--sf2); color: var(--mu); }
    .ic.p { background: var(--plb); color: var(--pl); }
    .ic.w { background: var(--wab); color: var(--wa); }
    .newtank { color: var(--pl); font-weight: 600; }
    .seg { padding: 3px; gap: 3px; }
    .seg button { height: 34px; }
    .msg { font-size: 13px; }
    .date { height: 40px; border: 1px solid var(--ln); border-radius: 12px; background: var(--sf); padding: 0 8px; font: 600 14px var(--font); }
    .switch input { appearance: none; width: 44px; height: 26px; border-radius: 13px; background: var(--ln); position: relative; cursor: pointer; margin: 0; transition: background .15s; }
    .switch input::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: var(--sf); transition: transform .15s; }
    .switch input:checked { background: var(--pl); }
    .switch input:checked::after { transform: translateX(18px); }
    .switch input:disabled { opacity: .5; cursor: default; }
    .check.small { min-height: 32px; font-weight: 500; font-size: 14px; }
    .diag { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
    .diag summary { font-weight: 600; cursor: pointer; min-height: 24px; }
    .diag pre { margin: 0; font: 12px/1.45 var(--mono); white-space: pre-wrap; word-break: break-all; background: var(--sf2); border-radius: 10px; padding: 10px; max-height: 360px; overflow: auto; }
    .linkbtn { border: 0; background: none; padding: 4px 0; min-height: 24px; color: var(--pl); font: 600 13px var(--font); text-decoration: underline; cursor: pointer; }
  `,
  template: `
    <div class="page" style="max-width: 720px">
      <header class="top"><h1 class="h1">Réglages</h1></header>

      <section>
        <h2 class="h2">Mes bacs</h2>
        <div class="card">
          @for (t of store.tanks(); track t.id) {
            <a class="it" [routerLink]="['/bacs', t.id, 'modifier']">
              <span class="ic" [class.p]="t.type === 'planted'" [class.w]="t.type !== 'planted'"><app-icon [name]="t.type === 'planted' ? 'sprout' : 'fish'" [size]="20" /></span>
              <div class="grow">
                <p style="font-weight: 600">{{ t.name }}</p>
                <p class="sub"><span class="num">{{ t.volumeGross }}</span> L · {{ types[t.type] }}{{ t.archived ? ' · archivé' : '' }}</p>
              </div>
              <app-icon name="chevron" [size]="18" style="color: var(--mu)" />
            </a>
          }
          <a class="it newtank" routerLink="/bacs/nouveau"><span class="ic p"><app-icon name="plus" [size]="20" /></span>Nouveau bac</a>
        </div>
      </section>

      <section>
        <h2 class="h2">Affichage</h2>
        <div class="card">
          <div class="it">
            <p class="grow" style="font-weight: 600">Thème</p>
            <div class="seg" role="group" aria-label="Thème">
              @for (c of themes; track c[0]) {
                <button type="button" [class.on]="theme.choice() === c[0]" [attr.aria-pressed]="theme.choice() === c[0]" (click)="theme.choice.set(c[0])">{{ c[1] }}</button>
              }
            </div>
          </div>
          <div class="it">
            <div class="grow"><p style="font-weight: 600">Unités</p><p class="sub">°C · mg/L · °d</p></div>
          </div>
        </div>
      </section>

      <section>
        <h2 class="h2">Rappels</h2>
        <div class="card">
          <div class="it" style="flex-wrap: wrap">
            <span class="ic w"><app-icon name="bell" [size]="20" /></span>
            <div class="grow" style="min-width: 160px">
              <p style="font-weight: 600">Notifications</p>
              <p class="sub">{{ notifStatus() }}</p>
            </div>
            <label class="switch">
              <input type="checkbox" role="switch" [checked]="prefs().enabled" [disabled]="!notif.supported || notif.permission() === 'denied'" (change)="toggleNotif($any($event.target).checked)" />
              <span class="sr-only">Activer les notifications</span>
            </label>
          </div>
          @if (prefs().enabled) {
            <div class="it" style="flex-wrap: wrap; gap: 10px 16px">
              <label class="row" style="gap: 8px; font-weight: 600">Heure
                <input type="time" class="date" [value]="prefs().time" (change)="setPref({ time: $any($event.target).value || '09:00' })" />
              </label>
              <label class="check small"><input type="checkbox" [checked]="prefs().tasks" (change)="setPref({ tasks: $any($event.target).checked })" />Tâches dues</label>
              <label class="check small"><input type="checkbox" [checked]="prefs().followUps" (change)="setPref({ followUps: $any($event.target).checked })" />Suivis de diagnostic</label>
              <button class="linkbtn" type="button" (click)="notif.test()">Tester</button>
            </div>
          }
          @if (prefs().enabled && auth.user() && push.supported) {
            <div class="it" style="flex-wrap: wrap">
              <span class="ic w"><app-icon name="bell" [size]="20" /></span>
              <div class="grow" style="min-width: 160px">
                <p style="font-weight: 600">Même appli fermée</p>
                <p class="sub" aria-live="polite">{{ pushStatus() }}</p>
              </div>
              <label class="switch">
                <input type="checkbox" role="switch" [checked]="push.enabled()" [disabled]="push.state() === 'busy'" (change)="togglePush($any($event.target).checked)" />
                <span class="sr-only">Recevoir les rappels même appli fermée</span>
              </label>
            </div>
          }
          <button class="it" type="button" style="width: 100%; border: 0; background: transparent; text-align: left; font: inherit; cursor: pointer" (click)="exportIcs()">
            <span class="ic w"><app-icon name="bell" [size]="20" /></span>
            <div class="grow"><p style="font-weight: 600">Ajouter à mon agenda</p><p class="sub">Fichier .ics avec les tâches répétées et une alerte à 9 h (Google Agenda, Outlook…)</p></div>
          </button>
          <div class="it" style="flex-wrap: wrap">
            <span class="ic"><app-icon name="moon" [size]="20" /></span>
            <div class="grow" style="min-width: 160px"><p style="font-weight: 600">Mode vacances</p><p class="sub">Décale au jour du retour les tâches qui tombent pendant l’absence</p></div>
            <div class="row" style="gap: 8px">
              <input type="date" class="date" aria-label="Date de retour" [min]="store.today()" [value]="returnDate()" (input)="returnDate.set($any($event.target).value)" />
              <button class="btn ton" type="button" [disabled]="!returnDate()" (click)="vacation()">Décaler</button>
            </div>
          </div>
        </div>
        <p class="sub" style="margin: 0">L’agenda n’est pas mis à jour automatiquement : réimporte le fichier si tu changes les tâches.</p>
      </section>

      <section>
        <h2 class="h2">Catalogue</h2>
        <div class="card">
          <div class="it" style="flex-wrap: wrap">
            <span class="ic"><app-icon name="download" [size]="20" /></span>
            <div class="grow" style="min-width: 160px">
              <p style="font-weight: 600">Catalogue en ligne (bêta)</p>
              <p class="sub" aria-live="polite">{{ catalogStatus() }}</p>
            </div>
            <label class="switch">
              <input type="checkbox" role="switch" [checked]="refSync.enabled()" [disabled]="!refSync.available" (change)="refSync.setEnabled($any($event.target).checked)" />
              <span class="sr-only">Utiliser le catalogue en ligne</span>
            </label>
          </div>
          @if (refSync.enabled()) {
            <div class="it">
              <button class="linkbtn" type="button" [disabled]="refSync.status() === 'syncing'" (click)="refSync.sync()">Mettre à jour maintenant</button>
            </div>
          }
        </div>
      </section>

      <section>
        <h2 class="h2">Assistant IA</h2>
        <div class="card">
          <a class="it" routerLink="/import-ia">
            <span class="ic w"><app-icon name="upload" [size]="20" /></span>
            <div class="grow"><p style="font-weight: 600">Importer depuis l’IA</p><p class="sub">Inventaire, tests en gouttes ou bilan visuel à partir d’une photo</p></div>
            <app-icon name="chevron" [size]="18" style="color: var(--mu)" />
          </a>
          <a class="it" routerLink="/diagnostic">
            <span class="ic w"><app-icon name="search" [size]="20" /></span>
            <div class="grow"><p style="font-weight: 600">Diagnostic IA</p><p class="sub">Envoie le dossier complet d’un bac (données, matériel, photos) à une IA</p></div>
            <app-icon name="chevron" [size]="18" style="color: var(--mu)" />
          </a>
          <a class="it" href="ai/my-aquarium-diagnostic.zip" download>
            <span class="ic"><app-icon name="download" [size]="20" /></span>
            <div class="grow"><p style="font-weight: 600">Skill diagnostic pour Claude</p><p class="sub">my-aquarium-diagnostic</p></div>
          </a>
          <a class="it" href="ai/my-aquarium-json.zip" download>
            <span class="ic"><app-icon name="download" [size]="20" /></span>
            <div class="grow"><p style="font-weight: 600">Skill pour Claude</p><p class="sub">À ajouter dans Claude › Paramètres › Capacités</p></div>
          </a>
        </div>
      </section>

      @if (auth.available) {
        <section>
          <h2 class="h2">Compte</h2>
          <div class="card">
            @if (auth.user(); as user) {
              <div class="it" style="flex-wrap: wrap">
                <span class="ic p"><app-icon name="check" [size]="20" /></span>
                <div class="grow" style="min-width: 160px">
                  <p style="font-weight: 600">{{ user.email }}</p>
                  <p class="sub">Connecté{{ user.role === 'admin' ? ' · administrateur' : '' }}</p>
                </div>
                <button class="btn out" type="button" (click)="logout()">Se déconnecter</button>
              </div>
              <div class="it" style="flex-wrap: wrap">
                <span class="ic" [class.p]="sync.status() === 'ok'" [class.w]="syncWarn()"><app-icon name="download" [size]="20" /></span>
                <div class="grow" style="min-width: 160px">
                  <p style="font-weight: 600">Synchronisation</p>
                  <p class="sub" aria-live="polite">{{ syncStatus() }}</p>
                </div>
                <button class="linkbtn" type="button" [disabled]="sync.status() === 'syncing'" (click)="sync.sync()">Synchroniser maintenant</button>
              </div>
              @for (d of auth.devices(); track d.id) {
                <div class="it" style="flex-wrap: wrap">
                  <div class="grow" style="min-width: 160px">
                    <p style="font-weight: 600">{{ d.device || 'Appareil inconnu' }}{{ d.current ? ' (cet appareil)' : '' }}</p>
                    <p class="sub">Dernière utilisation : {{ date(d.lastUsedAt) }}</p>
                  </div>
                  @if (!d.current) {
                    <button class="linkbtn" type="button" (click)="auth.revokeDevice(d.id)">Déconnecter</button>
                  }
                </div>
              }
              <div class="it" style="flex-wrap: wrap">
                <div class="grow" style="min-width: 160px">
                  <p style="font-weight: 600">Supprimer mon compte</p>
                  <p class="sub">Efface du serveur ton adresse, tes appareils et les données synchronisées. Tes données restent sur cet appareil.</p>
                </div>
                <button class="btn out" type="button" style="color: var(--dg)" (click)="deleteAccount()">Supprimer</button>
              </div>
            } @else {
              <a class="it" routerLink="/connexion">
                <span class="ic"><app-icon name="upload" [size]="20" /></span>
                <div class="grow"><p style="font-weight: 600">Se connecter</p><p class="sub">Facultatif : un lien arrive par e-mail, pas de mot de passe. L’appli marche très bien sans compte.</p></div>
                <app-icon name="chevron" [size]="18" style="color: var(--mu)" />
              </a>
            }
          </div>
          <p class="sub" style="margin: 0">
            <a routerLink="/mentions-legales">Mentions légales</a> · <a routerLink="/confidentialite">Confidentialité</a> · <a routerLink="/conditions">Conditions d’utilisation</a>
          </p>
          @if (accountMessage(); as m) {
            <p class="msg" [style.color]="m.error ? 'var(--dg)' : 'var(--ok)'" role="status">{{ m.text }}</p>
          }
        </section>
      }

      <section>
        <h2 class="h2">Données</h2>
        <div class="card" style="padding: 14px; display: flex; flex-direction: column; gap: 12px">
          <p class="sub" style="margin: 0">
            Tout est stocké sur cet appareil{{ photoStore.photos().length ? ', photos comprises (' + photoStore.photos().length + ')' : '' }}. Pense à exporter régulièrement : la sauvegarde contient aussi les photos.
            Dernière sauvegarde : <b style="color: var(--ink)">{{ backup.lastBackup() ? date(backup.lastBackup()!) : 'jamais' }}</b>
          </p>
          <p class="sub" style="margin: 0">
            @if (backup.persisted() === true) {
              <span style="color: var(--ok); font-weight: 600">Stockage protégé</span> : le navigateur ne l’effacera pas pour libérer de la place.
            } @else if (backup.persisted() === false) {
              <span style="color: var(--wn); font-weight: 600">Stockage non protégé</span> : le navigateur peut l’effacer s’il manque de place.
              Installe l’app sur l’écran d’accueil puis
              <button type="button" class="linkbtn" (click)="backup.requestPersist()">réessaie</button>.
            }
            @if (backup.usage(); as u) { Espace utilisé : {{ bytes(u.used) }}. }
          </p>
          <div class="row" style="flex-wrap: wrap; gap: 8px">
            <button class="btn fill" type="button" [disabled]="exporting()" (click)="exportFile()"><app-icon name="download" [size]="20" />{{ exporting() ? 'Export en cours…' : 'Exporter' }}</button>
            <label class="btn ton" style="cursor: pointer">
              <app-icon name="upload" [size]="20" />Importer
              <input type="file" accept=".zip,application/zip,.json,application/json" class="sr-only" (change)="importFile($event)" />
            </label>
          </div>
          @if (message(); as m) {
            <p class="msg" [style.color]="m.error ? 'var(--dg)' : 'var(--ok)'" role="status">{{ m.text }}</p>
          }
        </div>
      </section>

      <details class="card diag" (toggle)="diagOpen($any($event.target).open)">
        <summary>Détails techniques</summary>
        <p class="sub">Pour diagnostiquer un problème de connexion ou de synchronisation. Aucun mot de passe ni jeton n’y figure.</p>
        <pre>{{ diagText() }}</pre>
        <div class="row" style="gap: 8px; flex-wrap: wrap">
          <button class="btn ton" type="button" (click)="copyDiag()">Copier</button>
          <button class="btn out" type="button" (click)="refreshDiag()">Actualiser</button>
        </div>
        @if (diagCopied()) { <p class="msg" role="status" style="color: var(--ok)">{{ diagCopied() }}</p> }
      </details>
    </div>
  `,
})
export class SettingsPage {
  protected readonly refSync = inject(RefSyncService);
  protected readonly auth = inject(AuthService);
  protected readonly sync = inject(SyncService);
  private readonly diag = inject(DiagLog);
  private readonly apiUrl = inject(API_URL);
  private readonly localDb = inject(AQUARIUM_DB);
  private readonly syncMeta = signal<SyncMeta | undefined>(undefined);
  protected readonly diagCopied = signal('');

  protected readonly diagText = computed(() => {
    const user = this.auth.user();
    const meta = this.syncMeta();
    const nav = navigator as Omit<Navigator, 'locks' | 'serviceWorker'> & {
      locks?: unknown;
      serviceWorker?: { controller: unknown };
    };
    const lines = [
      `Date : ${new Date().toISOString()}`,
      `En ligne : ${nav.onLine ? 'oui' : 'non'}`,
      `API : ${this.apiUrl ?? 'non configurée'} · comptes ${this.auth.available ? 'ouverts' : 'fermés'}`,
      `Connecté : ${user ? `oui (${user.role})` : 'non'} · session mémorisée : ${readPref('signedIn') ?? 'non'}`,
      `Synchronisation : ${this.sync.status()} · en attente : ${String(this.sync.pending())} · dernière : ${this.sync.lastSync() ?? 'jamais'}`,
      `Curseur : ${meta ? String(meta.cursor) : 'aucun'} · compte de l’appareil : ${meta ? (meta.userId === user?.id ? 'le même' : 'différent') : 'aucun'}`,
      `Verrous entre onglets : ${nav.locks ? 'oui' : 'non'} · service worker : ${nav.serviceWorker?.controller ? 'actif' : 'non'}`,
      `Navigateur : ${nav.userAgent}`,
      '',
      'Derniers échanges (le plus récent en premier) :',
      ...this.diag.entries().map((e) => `${e.at.slice(11, 19)}  ${e.what}  →  ${e.result}`),
    ];
    if (this.diag.entries().length === 0) lines.push('(aucun depuis l’ouverture de l’appli)');
    return lines.join('\n');
  });

  protected diagOpen(open: boolean): void {
    if (open) void this.refreshDiag();
  }

  protected async refreshDiag(): Promise<void> {
    this.syncMeta.set(await this.localDb.syncMeta.get('sync'));
  }

  protected async copyDiag(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.diagText());
      this.diagCopied.set('Copié : colle-le dans ton message.');
    } catch {
      this.diagCopied.set('Copie impossible : sélectionne le texte à la main.');
    }
  }
  protected readonly syncWarn = computed(() =>
    ['offline', 'quota', 'error'].includes(this.sync.status()),
  );
  protected readonly syncStatus = computed(() => {
    const pending = this.sync.pending();
    const waiting = pending
      ? ` ${String(pending)} modification${pending > 1 ? 's' : ''} en attente.`
      : '';
    const last = this.sync.lastSync();
    switch (this.sync.status()) {
      case 'syncing':
        return 'Synchronisation en cours…';
      case 'ok':
        return `À jour${last ? ` (${new Date(last).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})` : ''}. Tes données sont aussi sur tes autres appareils connectés.${waiting}`;
      case 'offline':
        return `Hors ligne : envoi au retour du réseau.${waiting}`;
      case 'quota':
        return `Limite de données du compte atteinte : les nouvelles modifications restent sur cet appareil.${waiting}`;
      case 'error':
        return `Le serveur n’a pas répondu, nouvel essai dans quelques minutes.${waiting}`;
      default:
        return `En attente.${waiting}`;
    }
  });
  protected readonly accountMessage = signal<{ text: string; error: boolean } | null>(null);

  protected async deleteAccount(): Promise<void> {
    const email = this.auth.user()?.email ?? '';
    if (
      !confirm(
        `Supprimer définitivement le compte ${email} ? Ton adresse, tes appareils et les données synchronisées seront effacés du serveur. Tes données resteront sur cet appareil. Cette action est irréversible.`,
      )
    )
      return;
    const ok = await this.auth.deleteAccount();
    this.accountMessage.set(
      ok
        ? { text: 'Compte supprimé. Tes données restent sur cet appareil.', error: false }
        : {
            text: 'Suppression impossible pour le moment. Vérifie ta connexion puis réessaie.',
            error: true,
          },
    );
  }

  constructor() {
    // La liste des appareils se charge dès qu'on est connecté (y compris après la reprise de session).
    effect(() => {
      if (this.auth.user() !== null) void this.auth.loadDevices();
    });
  }
  protected readonly catalogStatus = computed(() => {
    if (!this.refSync.available) return 'Service pas encore disponible.';
    if (!this.refSync.enabled())
      return 'Désactivé : l’appli utilise son catalogue intégré (réglage par défaut).';
    switch (this.refSync.status()) {
      case 'syncing':
        return 'Mise à jour en cours…';
      case 'ok':
        return 'Catalogue à jour.';
      case 'error':
        return 'Serveur injoignable : le catalogue déjà enregistré sur l’appareil est utilisé.';
      default:
        return 'Activé : mise à jour à chaque ouverture de l’appli.';
    }
  });
  protected readonly notif = inject(NotificationService);
  protected readonly prefs = inject(PrefsStore).notificationPrefs;
  protected readonly notifStatus = computed(() => {
    if (!this.notif.supported) return 'Ce navigateur ne gère pas les notifications.';
    if (this.notif.permission() === 'denied')
      return 'Bloquées dans les réglages du navigateur pour ce site.';
    if (!this.prefs().enabled)
      return 'Un rappel par jour quand une tâche est due ou un suivi de diagnostic arrive.';
    return this.notif.background()
      ? `Chaque jour à ${this.prefs().time}, même appli fermée.`
      : `Chaque jour à partir de ${this.prefs().time}, à l’ouverture de l’appli. Installe-la sur Android (Chrome) pour les recevoir appli fermée.`;
  });
  protected readonly push = inject(PushService);
  protected readonly pushStatus = computed(() => {
    if (!this.push.enabled()) {
      return this.push.state() === 'denied'
        ? 'Notifications bloquées dans les réglages du navigateur pour ce site.'
        : 'Envoyés par le serveur à l’heure choisie, sur chaque appareil où tu l’actives.';
    }
    switch (this.push.state()) {
      case 'busy':
        return 'Activation…';
      case 'error':
        return 'Le serveur n’a pas pu enregistrer cet appareil : nouvel essai à la prochaine ouverture.';
      default:
        return `Activé : le rappel arrive vers ${this.prefs().time}, même appli fermée (parfois avec un peu de retard).`;
    }
  });

  protected async togglePush(on: boolean): Promise<void> {
    if (on) await this.push.enable();
    else await this.push.disable();
  }

  protected async logout(): Promise<void> {
    await this.push.forgetDevice();
    await this.auth.logout();
  }

  protected async toggleNotif(on: boolean): Promise<void> {
    if (on) await this.notif.enable();
    else await this.notif.disable();
  }
  protected setPref(patch: Partial<NotificationPrefs>): void {
    void this.prefsRepo.saveNotificationPrefs(patch);
  }

  protected readonly store = inject(AquariumStore);
  protected readonly photoStore = inject(PhotoStore);
  protected readonly careStore = inject(CareStore);
  protected readonly prefsStore = inject(PrefsStore);

  protected readonly backupRepo = inject(BackupRepo);

  protected readonly careRepo = inject(CareRepo);

  protected readonly prefsRepo = inject(PrefsRepo);
  protected readonly theme = inject(ThemeService);
  protected readonly types = TANK_TYPES;
  protected readonly themes: [ThemeChoice, string][] = [
    ['light', 'Clair'],
    ['dark', 'Sombre'],
    ['auto', 'Auto'],
  ];

  protected readonly backup = inject(BackupService);
  protected readonly bytes = fmtBytes;
  protected readonly date = fmtShortDate;
  protected readonly message = signal<{ text: string; error: boolean } | null>(null);

  protected readonly returnDate = signal('');

  protected async vacation(): Promise<void> {
    const until = this.returnDate();
    if (!until) return;
    const n = await this.careRepo.postponeTasks(until);
    this.message.set({
      text: n
        ? `${n} tâche${n > 1 ? 's' : ''} décalée${n > 1 ? 's' : ''} au ${fmtShortDate(until)} — bonnes vacances !`
        : 'Aucune tâche à décaler.',
      error: false,
    });
  }

  protected exportIcs(): void {
    const ics = tasksToIcs(this.careStore.tasks(), this.store.activeTanks());
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aquariums-rappels.ics';
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  protected readonly exporting = signal(false);

  protected async exportFile(): Promise<void> {
    this.exporting.set(true);
    try {
      await this.backup.exportNow();
      this.message.set({ text: 'Sauvegarde téléchargée.', error: false });
    } catch (err) {
      this.message.set({
        text: err instanceof Error ? err.message : 'Export impossible.',
        error: true,
      });
    } finally {
      this.exporting.set(false);
    }
  }

  protected async importFile(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!confirm('L’import remplace toutes les données de cet appareil. Continuer ?')) return;
    try {
      const warnings = await this.backupRepo.importBackup(file);
      const note = warnings.length ? ` Remarques : ${warnings.join(' ; ')}.` : '';
      this.message.set({ text: `Données importées.${note}`, error: false });
    } catch (err) {
      this.message.set({
        text: err instanceof Error ? err.message : 'Import impossible.',
        error: true,
      });
    }
  }
}
