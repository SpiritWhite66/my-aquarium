import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { AquariumStore } from './store';
import { PrefsStore } from './stores/prefs.store';
import { CareStore } from './stores/care.store';
import { DIGEST_DAYS, digestsAhead, shouldNotify, type Digest } from './reminders';
import { addDays } from './dates';
import { PrefsRepo } from './data/prefs.repo';

const SYNC_TAG = 'aquarium-reminders';

/**
 * Notifications quotidiennes (tâches dues, suivis de diagnostic), sans serveur :
 *  - l'appli prépare le texte des 30 prochains jours dans IndexedDB ;
 *  - elle l'affiche à l'heure choisie quand elle est ouverte (vérification toutes les 5 min) ;
 *  - le service worker l'affiche en arrière-plan là où la synchronisation périodique existe
 *    (Chrome sur Android, appli installée).
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly store = inject(AquariumStore);
  private readonly prefsStore = inject(PrefsStore);
  private readonly careStore = inject(CareStore);
  private readonly prefsRepo = inject(PrefsRepo);

  readonly supported = typeof window !== 'undefined' && 'Notification' in window;
  readonly permission = signal<NotificationPermission>(this.supported ? Notification.permission : 'denied');
  /** Synchronisation périodique accordée : rappels même appli fermée. */
  readonly background = signal(false);

  private readonly prefs = this.prefsStore.notificationPrefs;
  private readonly digests = computed(() => {
    const p = this.prefs();
    if (!p.enabled) return {};
    return digestsAhead(this.store.today(), { tasks: this.careStore.tasks(), diagnoses: this.careStore.diagnoses(), tanks: this.store.tanks() }, p);
  });

  constructor() {
    // Garde à jour le texte préparé pour le service worker.
    effect(() => {
      const digests = this.digests();
      const p = this.prefs();
      if (!p.enabled || !this.store.ready()) return;
      const until = addDays(this.store.today(), DIGEST_DAYS - 1);
      if (until !== p.digestsUntil || JSON.stringify(digests) !== JSON.stringify(p.digests ?? {})) {
        this.prefsRepo.saveNotificationPrefs({ digests, digestsUntil: until });
      }
      this.check();
    });
    if (typeof window === 'undefined') return;
    const timer = setInterval(() => this.check(), 5 * 60_000);
    const onVisible = () => document.visibilityState === 'visible' && this.check();
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    });
    this.refreshBackground();
  }

  /** Active les rappels : demande l'autorisation, puis la synchronisation en arrière-plan si possible. */
  async enable(): Promise<boolean> {
    if (!this.supported) return false;
    const perm = await Notification.requestPermission();
    this.permission.set(perm);
    if (perm !== 'granted') return false;
    await this.prefsRepo.saveNotificationPrefs({ enabled: true });
    await this.registerBackground();
    return true;
  }

  async disable(): Promise<void> {
    await this.prefsRepo.saveNotificationPrefs({ enabled: false });
    const reg = await this.registration();
    await (reg as PeriodicReg | undefined)?.periodicSync?.unregister(SYNC_TAG).catch(() => undefined);
    this.background.set(false);
  }

  /** Affiche tout de suite la notification du jour (ou un exemple). */
  async test(): Promise<void> {
    const today = this.digests()[this.store.today()];
    await this.show(today ?? { title: 'Rappels activés', body: 'Rien à faire aujourd’hui. Tu seras prévenu les jours où une tâche est due.' });
  }

  /** Évite deux vérifications simultanées (minuteur + retour sur l'onglet) qui afficheraient deux fois. */
  private checking = false;
  /** Jour déjà notifié : les préférences relues de la base peuvent avoir un instant de retard. */
  private shownOn = '';

  async check(): Promise<void> {
    if (this.permission() !== 'granted' || this.checking) return;
    this.checking = true;
    try {
      const today = this.store.today();
      if (this.shownOn === today) return;
      const digest = shouldNotify({ ...this.prefs(), digests: this.digests(), digestsUntil: addDays(today, DIGEST_DAYS - 1) }, new Date(), today);
      if (!digest) return;
      this.shownOn = today;
      await this.prefsRepo.saveNotificationPrefs({ lastShown: today });
      await this.show(digest);
    } finally {
      this.checking = false;
    }
  }

  private async show(d: Digest): Promise<void> {
    const options = { body: d.body, icon: 'icons/icon-192x192.png', badge: 'icons/icon-192x192.png', tag: 'aquarium-daily' };
    const reg = await this.registration();
    if (reg) await reg.showNotification(d.title, options);
    // L'API peut manquer (navigateur sans notifications, ou retirée entre-temps) : rien à afficher.
    else if (typeof Notification !== 'undefined') new Notification(d.title, options);
  }

  private async registration(): Promise<ServiceWorkerRegistration | undefined> {
    if (!('serviceWorker' in navigator)) return undefined;
    return (await navigator.serviceWorker.getRegistration()) ?? undefined;
  }

  private async registerBackground(): Promise<void> {
    const reg = (await this.registration()) as PeriodicReg | undefined;
    if (!reg?.periodicSync) return;
    try {
      const status = await navigator.permissions.query({ name: 'periodic-background-sync' as PermissionName });
      if (status.state !== 'granted') return;
      await reg.periodicSync.register(SYNC_TAG, { minInterval: 6 * 3600_000 });
      this.background.set(true);
    } catch {
      /* non pris en charge */
    }
  }

  private async refreshBackground(): Promise<void> {
    const reg = (await this.registration()) as PeriodicReg | undefined;
    const tags = await reg?.periodicSync?.getTags().catch((): string[] => []);
    this.background.set(!!tags?.includes(SYNC_TAG));
  }
}

type PeriodicReg = ServiceWorkerRegistration & {
  periodicSync?: { register(tag: string, o: { minInterval: number }): Promise<void>; unregister(tag: string): Promise<void>; getTags(): Promise<string[]> };
};
