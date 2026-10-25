import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { AquariumStore } from '../../core/store';
import type { Tank, TankType } from '../../core/models';
import { TANK_TYPES, parseNumber } from '../../core/labels';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-tank-form',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: flex; flex-direction: column; gap: 16px; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  `,
  template: `
    <div class="page" style="max-width: 640px">
      <header class="top" style="justify-content: flex-start">
        <button class="iconbtn" type="button" aria-label="Retour" (click)="location.back()"><app-icon name="back" /></button>
        <h1 class="h1 grow">{{ id() ? 'Modifier le bac' : 'Nouveau bac' }}</h1>
      </header>
      <form (submit)="$event.preventDefault(); save()">
        <div class="form-grid">
          <div class="field full">
            <label for="name">Nom</label>
            <input id="name" required [value]="name()" (input)="name.set(val($event))" placeholder="Bac salon" />
          </div>
          <div class="field full">
            <label for="type">Type</label>
            <select id="type" [value]="type()" (change)="type.set($any(val($event)))">
              @for (t of typeList; track t[0]) {
                <option [value]="t[0]">{{ t[1] }}</option>
              }
            </select>
          </div>
          <div class="field">
            <label for="vg">Volume brut (L)</label>
            <input id="vg" class="num" inputmode="decimal" required [value]="volumeGross()" (input)="volumeGross.set(val($event))" />
          </div>
          <div class="field">
            <label for="vn">Volume réel (L)</label>
            <input id="vn" class="num" inputmode="decimal" [value]="volumeNet()" (input)="volumeNet.set(val($event))" placeholder="optionnel" />
          </div>
          <div class="field">
            <label for="start">Mise en eau</label>
            <input id="start" type="date" [value]="startDate()" (input)="startDate.set(val($event))" />
          </div>
          <div class="field">
            <label for="photo">Éclairage (h/jour)</label>
            <input id="photo" class="num" inputmode="decimal" [value]="photoperiod()" (input)="photoperiod.set(val($event))" placeholder="8" />
          </div>
          <div class="field full">
            <label for="sub">Substrat</label>
            <input id="sub" [value]="substrate()" (input)="substrate.set(val($event))" placeholder="Sol nutritif, sable…" />
          </div>
          <div class="field full">
            <label for="notes">Notes</label>
            <textarea id="notes" [value]="notes()" (input)="notes.set(val($event))"></textarea>
          </div>
        </div>
        <label class="check"><input type="checkbox" [checked]="co2()" (change)="co2.set($any($event.target).checked)" />Injection de CO2</label>
        @if (!id()) {
          <label class="check"><input type="checkbox" [checked]="defaults()" (change)="defaults.set($any($event.target).checked)" />Créer les tâches d’entretien habituelles</label>
        }
        <div class="actions">
          <button class="btn fill" type="submit" [disabled]="!valid()">Enregistrer</button>
          @if (existing(); as t) {
            <button class="btn out" type="button" (click)="toggleArchive(t)">{{ t.archived ? 'Désarchiver' : 'Archiver' }}</button>
            <button class="btn danger" type="button" (click)="remove(t)"><app-icon name="trash" [size]="18" />Supprimer</button>
          }
        </div>
      </form>
    </div>
  `,
})
export class TankFormPage {
  private readonly store = inject(AquariumStore);
  private readonly router = inject(Router);
  protected readonly location = inject(Location);

  readonly id = input<string>();

  protected readonly typeList = Object.entries(TANK_TYPES) as [TankType, string][];
  protected readonly name = signal('');
  protected readonly type = signal<TankType>('planted');
  protected readonly volumeGross = signal('');
  protected readonly volumeNet = signal('');
  protected readonly startDate = signal(this.store.today());
  protected readonly photoperiod = signal('');
  protected readonly substrate = signal('');
  protected readonly notes = signal('');
  protected readonly co2 = signal(false);
  protected readonly defaults = signal(true);

  protected readonly existing = computed(() => this.store.tanks().find((t) => t.id === this.id()));
  protected readonly valid = computed(() => this.name().trim() && (parseNumber(this.volumeGross()) ?? 0) > 0);

  private loaded = false;

  constructor() {
    // Remplit le formulaire une seule fois quand le bac est chargé.
    effect(() => {
      const t = this.existing();
      if (!t || this.loaded) return;
      this.loaded = true;
      this.name.set(t.name);
      this.type.set(t.type);
      this.volumeGross.set(String(t.volumeGross).replace('.', ','));
      this.volumeNet.set(t.volumeNet != null ? String(t.volumeNet).replace('.', ',') : '');
      this.startDate.set(t.startDate);
      this.photoperiod.set(t.lighting?.photoperiodHours != null ? String(t.lighting.photoperiodHours) : '');
      this.substrate.set(t.substrate ?? '');
      this.notes.set(t.notes ?? '');
      this.co2.set(t.co2);
    });
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected async save(): Promise<void> {
    if (!this.valid()) return;
    const prev = this.existing();
    const photo = parseNumber(this.photoperiod());
    const id = await this.store.saveTank(
      {
        ...(prev ?? {}),
        id: this.id(),
        name: this.name().trim(),
        type: this.type(),
        volumeGross: parseNumber(this.volumeGross())!,
        volumeNet: parseNumber(this.volumeNet()),
        startDate: this.startDate(),
        substrate: this.substrate().trim() || undefined,
        notes: this.notes().trim() || undefined,
        co2: this.co2(),
        lighting: photo != null ? { ...prev?.lighting, photoperiodHours: photo } : prev?.lighting,
        archived: prev?.archived ?? false,
      },
      !prev && this.defaults(),
    );
    this.router.navigate(['/bacs', id]);
  }

  protected async toggleArchive(t: Tank): Promise<void> {
    await this.store.archiveTank(t.id, !t.archived);
    this.router.navigate(['/bacs']);
  }

  protected async remove(t: Tank): Promise<void> {
    if (!confirm(`Supprimer « ${t.name} » et tout son historique ? Cette action est définitive.`)) return;
    await this.store.deleteTank(t.id);
    this.router.navigate(['/bacs']);
  }
}
