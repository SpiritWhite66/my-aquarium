import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { AquariumStore } from '../../core/store';
import type { Tank, TankType } from '../../core/models';
import { TANK_TYPES, parseNumber } from '../../core/labels';
import { Icon } from '../../shared/icon';
import { TankRepo } from '../../core/data/tank.repo';
import { fromEntity } from '../../shared/form-state';

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
            <select id="type" (change)="type.set($any(val($event)))">
              @for (t of typeList; track t[0]) {
                <option [value]="t[0]" [selected]="t[0] === type()">{{ t[1] }}</option>
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
        @if (co2()) {
          <div class="field" style="max-width: 280px">
            <label for="co2t">Débit CO2 visé (bulles/min)</label>
            <input id="co2t" class="num" inputmode="numeric" [value]="co2Target()" (input)="co2Target.set(val($event))" placeholder="60" />
          </div>
        }
        <label class="check"><input type="checkbox" [checked]="cycling()" (change)="cycling.set($any($event.target).checked)" />Bac en cours de cyclage (pas encore d’animaux)</label>
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
  protected readonly tankRepo = inject(TankRepo);
  private readonly router = inject(Router);
  protected readonly location = inject(Location);

  readonly id = input<string>();

  protected readonly typeList = Object.entries(TANK_TYPES) as [TankType, string][];
  protected readonly existing = computed(() => this.store.tanks().find((t) => t.id === this.id()));
  // Chaque champ prend la valeur du bac enregistré quand il est chargé (modification), puis appartient à la saisie.
  protected readonly name = fromEntity(this.existing, (t) => t.name, '');
  protected readonly type = fromEntity<Tank, TankType>(this.existing, (t) => t.type, 'planted');
  protected readonly volumeGross = fromEntity(this.existing, (t) => String(t.volumeGross).replace('.', ','), '');
  protected readonly volumeNet = fromEntity(this.existing, (t) => (t.volumeNet != null ? String(t.volumeNet).replace('.', ',') : ''), '');
  protected readonly startDate = fromEntity(this.existing, (t) => t.startDate, this.store.today());
  protected readonly photoperiod = fromEntity(this.existing, (t) => (t.lighting?.photoperiodHours != null ? String(t.lighting.photoperiodHours) : ''), '');
  protected readonly substrate = fromEntity(this.existing, (t) => t.substrate ?? '', '');
  protected readonly notes = fromEntity(this.existing, (t) => t.notes ?? '', '');
  protected readonly co2 = fromEntity(this.existing, (t) => t.co2, false);
  protected readonly cycling = fromEntity(this.existing, (t) => !!t.cycling, false);
  protected readonly co2Target = fromEntity(this.existing, (t) => (t.co2Target != null ? String(t.co2Target) : ''), '');
  protected readonly defaults = signal(true);

  protected readonly valid = computed(() => this.name().trim() && (parseNumber(this.volumeGross()) ?? 0) > 0);

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected async save(): Promise<void> {
    if (!this.valid()) return;
    const prev = this.existing();
    const photo = parseNumber(this.photoperiod());
    const id = await this.tankRepo.saveTank(
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
        cycling: this.cycling() || undefined,
        co2Target: this.co2() ? parseNumber(this.co2Target()) : undefined,
        lighting: photo != null ? { ...prev?.lighting, photoperiodHours: photo } : prev?.lighting,
        archived: prev?.archived ?? false,
      },
      !prev && this.defaults(),
    );
    this.router.navigate(['/bacs', id]);
  }

  protected async toggleArchive(t: Tank): Promise<void> {
    await this.tankRepo.archiveTank(t.id, !t.archived);
    this.router.navigate(['/bacs']);
  }

  protected async remove(t: Tank): Promise<void> {
    if (!confirm(`Supprimer « ${t.name} » et tout son historique ? Cette action est définitive.`)) return;
    await this.tankRepo.deleteTank(t.id);
    this.router.navigate(['/bacs']);
  }
}
