import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Location } from '@angular/common';
import { AquariumStore } from '../../core/store';
import { GearStore } from '../../core/stores/gear.store';
import type {
  Co2Spec,
  Consumable,
  ConsumableCategory,
  Equipment,
  EquipmentType,
  FilterSpec,
  HeaterSpec,
  LightSpec,
  StockLevel,
} from '../../core/models';
import { photoperiod } from '../../core/insights';
import { fmt } from '../../core/labels';
import {
  CONSUMABLE_CATEGORIES,
  EQUIPMENT_TYPES,
  STOCK_LEVELS,
  parseNumber,
} from '../../core/labels';
import { Icon } from '../../shared/icon';
import { fromEntity } from '../../shared/form-state';
import { describeChange, diffSettings } from '../../core/settings-history';
import { todayIso } from '../../core/dates';
import { GearRepo } from '../../core/data/gear.repo';
import { must } from '../../core/assert';

const v = (e: Event) => (e.target as HTMLInputElement).value;
const str = (n?: number) => (n == null ? '' : String(n).replace('.', ','));

/** Formulaire d'un équipement. */
@Component({
  selector: 'app-equipment-form',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page" style="max-width: 640px">
      <header class="top" style="justify-content: flex-start">
        <button class="iconbtn" type="button" aria-label="Retour" (click)="location.back()"><app-icon name="back" /></button>
        <h1 class="h1 grow">{{ existing() ? 'Modifier l’équipement' : 'Nouvel équipement' }}</h1>
      </header>
      <form class="stack" style="gap: 16px" (submit)="$event.preventDefault(); save()">
        <div class="form-grid">
          <div class="field full"><label for="name">Nom</label>
            <input id="name" required [value]="name()" (input)="name.set(v($event))" placeholder="Filtre extérieur" /></div>
          <div class="field"><label for="type">Type</label>
            <select id="type" (change)="type.set($any($event.target).value)">
              @for (t of types; track t[0]) { <option [value]="t[0]" [selected]="t[0] === type()">{{ t[1] }}</option> }
            </select></div>
          <div class="field"><label for="tank">Bac</label>
            <select id="tank" (change)="tankId.set($any($event.target).value)">
              <option value="" [selected]="!tankId()">En réserve</option>
              @for (t of store.activeTanks(); track t.id) { <option [value]="t.id" [selected]="t.id === tankId()">{{ t.name }}</option> }
            </select></div>
          <div class="field"><label for="brand">Marque</label><input id="brand" [value]="brand()" (input)="brand.set(v($event))" /></div>
          <div class="field"><label for="model">Modèle</label><input id="model" [value]="model()" (input)="model.set(v($event))" /></div>
          <div class="field full"><label for="specs">Autres caractéristiques</label>
            <input id="specs" [value]="specs()" (input)="specs.set(v($event))" /></div>
          <div class="field"><label for="bought">Date d’achat</label><input id="bought" type="date" [value]="purchaseDate()" (input)="purchaseDate.set(v($event))" /></div>
          <div class="field"><label for="warranty">Garantie (mois)</label>
            <input id="warranty" class="num" inputmode="numeric" [value]="warranty()" (input)="warranty.set(v($event))" placeholder="24" /></div>
          <div class="field"><label for="price">Prix (€)</label><input id="price" class="num" inputmode="decimal" [value]="price()" (input)="price.set(v($event))" /></div>
          <div class="field full"><label for="notes">Notes</label><textarea id="notes" [value]="notes()" (input)="notes.set(v($event))"></textarea></div>
        </div>

        @if (type() === 'light') {
          <section class="stack">
            <h2 class="h2">Éclairage</h2>
            <p class="lbl">Canaux</p>
            <div class="chips" role="group" aria-label="Canaux de couleur">
              @for (c of channelList; track c) {
                <button type="button" class="chipbtn" [class.on]="light().channels?.includes(c)" [attr.aria-pressed]="!!light().channels?.includes(c)" (click)="toggleChannel(c)">{{ c }}</button>
              }
            </div>
            <div class="form-grid">
              <div class="field"><label for="l-on">Allumage</label><input id="l-on" type="time" [value]="light().schedule?.on ?? ''" (input)="setSchedule('schedule', 'on', v($event))" /></div>
              <div class="field"><label for="l-off">Extinction</label><input id="l-off" type="time" [value]="light().schedule?.off ?? ''" (input)="setSchedule('schedule', 'off', v($event))" /></div>
              <div class="field"><label for="s-on">Sieste : début</label><input id="s-on" type="time" [value]="light().siesta?.on ?? ''" (input)="setSchedule('siesta', 'on', v($event))" /></div>
              <div class="field"><label for="s-off">Sieste : fin</label><input id="s-off" type="time" [value]="light().siesta?.off ?? ''" (input)="setSchedule('siesta', 'off', v($event))" /></div>
              <div class="field"><label for="l-int">Intensité réglée (%)</label><input id="l-int" class="num" inputmode="numeric" [value]="str(light().intensityPct)" (input)="setLight('intensityPct', v($event))" /></div>
              <div class="field"><label for="l-lev">Niveaux de puissance</label><input id="l-lev" class="num" inputmode="numeric" [value]="str(light().levels)" (input)="setLight('levels', v($event))" /></div>
              <div class="field"><label for="l-ramp">Lever/coucher (min)</label><input id="l-ramp" class="num" inputmode="numeric" [value]="str(light().rampMinutes)" (input)="setLight('rampMinutes', v($event))" /></div>
              <div class="field"><label for="l-par">PAR au sol (µmol/m²/s)</label><input id="l-par" class="num" inputmode="numeric" [value]="str(light().par)" (input)="setLight('par', v($event))" /></div>
              <div class="field"><label for="l-w">Puissance (W)</label><input id="l-w" class="num" inputmode="decimal" [value]="str(light().powerW)" (input)="setLight('powerW', v($event))" /></div>
              <div class="field"><label for="l-lm">Lumens</label><input id="l-lm" class="num" inputmode="numeric" [value]="str(light().lumens)" (input)="setLight('lumens', v($event))" /></div>
              <div class="field"><label for="l-k">Température (K)</label><input id="l-k" class="num" inputmode="numeric" [value]="str(light().kelvin)" (input)="setLight('kelvin', v($event))" /></div>
            </div>
            @if (hours(); as h) { <p class="sub" style="margin: 0">Durée d’éclairage : <b>{{ h }} h</b> par jour.</p> }
          </section>
        }
        @if (type() === 'filter' || type() === 'pump') {
          <section class="stack">
            <h2 class="h2">Filtration</h2>
            <div class="form-grid">
              <div class="field"><label for="f-flow">Débit annoncé (L/h)</label><input id="f-flow" class="num" inputmode="numeric" [value]="str(filter().flowLh)" (input)="filter.update(f => ({ ...f, flowLh: num(v($event)) }))" /></div>
              <div class="field"><label for="f-media">Masses filtrantes</label><input id="f-media" [value]="filter().media ?? ''" placeholder="Mousse, céramique…" (input)="filter.update(f => ({ ...f, media: v($event) || undefined }))" /></div>
            </div>
          </section>
        }
        @if (type() === 'heater') {
          <section class="stack">
            <h2 class="h2">Chauffage</h2>
            <div class="form-grid">
              <div class="field"><label for="h-w">Puissance (W)</label><input id="h-w" class="num" inputmode="numeric" [value]="str(heater().powerW)" (input)="heater.update(h => ({ ...h, powerW: num(v($event)) }))" /></div>
              <div class="field"><label for="h-c">Consigne (°C)</label><input id="h-c" class="num" inputmode="decimal" [value]="str(heater().setpointC)" (input)="heater.update(h => ({ ...h, setpointC: num(v($event)) }))" /></div>
            </div>
          </section>
        }
        @if (type() === 'co2') {
          <section class="stack">
            <h2 class="h2">Installation CO2</h2>
            <div class="form-grid">
              <div class="field"><label for="c-src">Source</label>
                <select id="c-src" (change)="co2.update(c => ({ ...c, source: $any($event.target).value || undefined }))">
                  <option value="" [selected]="!co2().source">Non précisée</option>
                  <option value="cylinder" [selected]="co2().source === 'cylinder'">Bouteille</option>
                  <option value="citric" [selected]="co2().source === 'citric'">Acide citrique</option>
                  <option value="yeast" [selected]="co2().source === 'yeast'">Levure</option>
                </select></div>
              <div class="field"><label for="c-l">Bouteille (L)</label><input id="c-l" class="num" inputmode="decimal" [value]="str(co2().cylinderL)" (input)="co2.update(c => ({ ...c, cylinderL: num(v($event)) }))" /></div>
              <div class="field full"><label for="c-diff">Diffuseur</label><input id="c-diff" [value]="co2().diffuser ?? ''" (input)="co2.update(c => ({ ...c, diffuser: v($event) || undefined }))" /></div>
              <div class="field"><label for="c-on">Ouverture</label><input id="c-on" type="time" [value]="co2().schedule?.on ?? ''" (input)="setCo2Schedule('on', v($event))" /></div>
              <div class="field"><label for="c-off">Fermeture</label><input id="c-off" type="time" [value]="co2().schedule?.off ?? ''" (input)="setCo2Schedule('off', v($event))" /></div>
            </div>
            <label class="check"><input type="checkbox" [checked]="!!co2().solenoid" (change)="co2.update(c => ({ ...c, solenoid: $any($event.target).checked }))" />Électrovanne programmée</label>
          </section>
        }

        @if (pending().length) {
          <section class="card changes">
            <h2 class="h2">Changement de réglage</h2>
            <ul>
              @for (c of pending(); track c.field) { <li>{{ describe(c) }}</li> }
            </ul>
            <p class="sub" style="margin: 0">Il sera gardé dans l’historique du bac pour voir son effet sur les algues.</p>
            <div class="form-grid">
              <div class="field"><label for="ch-date">Depuis le</label>
                <input id="ch-date" type="date" [max]="store.today()" [value]="changeDate()" (input)="changeDate.set(v($event))" /></div>
              <div class="field"><label for="ch-note">Pourquoi (facultatif)</label>
                <input id="ch-note" [value]="changeNote()" (input)="changeNote.set(v($event))" placeholder="Algues vertes sur les vitres" /></div>
            </div>
          </section>
        }

        <div class="row" style="gap: 8px; flex-wrap: wrap">
          <button class="btn fill" type="submit" [disabled]="!name().trim()">Enregistrer</button>
          @if (existing()) {
            <button class="btn danger" type="button" (click)="remove()"><app-icon name="trash" [size]="18" />Supprimer</button>
          }
        </div>
      </form>
    </div>
  `,
  styles: `
    .chipbtn { height: 36px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--ln); background: var(--sf); font: 600 13px var(--font); cursor: pointer; }
    .chipbtn.on { background: var(--ink); color: var(--bg); border-color: var(--ink); }
    .changes { padding: 14px; display: flex; flex-direction: column; gap: 10px; box-shadow: inset 3px 0 0 var(--wa); }
    .changes ul { margin: 0; padding-left: 18px; font-size: 14px; font-weight: 600; }
  `,
})
export class EquipmentFormPage {
  protected readonly describe = describeChange;
  protected readonly existing = computed(() =>
    this.gearStore.equipment().find((e) => e.id === this.id()),
  );
  protected readonly changeDate = signal(todayIso());
  protected readonly changeNote = signal('');
  /** Réglages suivis modifiés par rapport à la version enregistrée. */
  protected readonly pending = computed(() => {
    const e = this.existing();
    if (!e) return [];
    return diffSettings(e, {
      light: this.light(),
      co2: this.co2(),
      heater: this.heater(),
      filter: this.filter(),
    }).filter((d) => {
      const t = this.type();
      return d.field.startsWith(t === 'pump' ? 'filter' : t + '.');
    });
  });
  protected readonly str = str;
  protected readonly num = parseNumber;
  protected readonly channelList = ['Blanc', 'Rouge', 'Vert', 'Bleu', 'Blanc chaud', 'UV'];
  protected readonly light = fromEntity<Equipment, LightSpec>(
    this.existing,
    (e) => e.light ?? {},
    {},
  );
  protected readonly filter = fromEntity<Equipment, FilterSpec>(
    this.existing,
    (e) => e.filter ?? {},
    {},
  );
  protected readonly heater = fromEntity<Equipment, HeaterSpec>(
    this.existing,
    (e) => e.heater ?? {},
    {},
  );
  protected readonly co2 = fromEntity<Equipment, Co2Spec>(this.existing, (e) => e.co2 ?? {}, {});
  protected readonly hours = computed(() => {
    const h = photoperiod(this.light());
    return h ? fmt(h) : '';
  });

  protected toggleChannel(c: string): void {
    this.light.update((l) => {
      const set = new Set(l.channels ?? []);
      if (set.has(c)) set.delete(c);
      else set.add(c);
      return { ...l, channels: [...set] };
    });
  }
  protected setLight(
    key: 'intensityPct' | 'levels' | 'rampMinutes' | 'par' | 'powerW' | 'lumens' | 'kelvin',
    raw: string,
  ): void {
    this.light.update((l) => ({ ...l, [key]: parseNumber(raw) }));
  }
  protected setSchedule(which: 'schedule' | 'siesta', part: 'on' | 'off', value: string): void {
    this.light.update((l) => {
      const s = { on: '', off: '', ...l[which], [part]: value };
      return { ...l, [which]: s.on || s.off ? s : undefined };
    });
  }
  protected setCo2Schedule(part: 'on' | 'off', value: string): void {
    this.co2.update((c) => {
      const s = { on: '', off: '', ...c.schedule, [part]: value };
      return { ...c, schedule: s.on || s.off ? s : undefined };
    });
  }

  protected readonly store = inject(AquariumStore);
  protected readonly gearStore = inject(GearStore);

  protected readonly gearRepo = inject(GearRepo);
  protected readonly location = inject(Location);
  protected readonly v = v;
  readonly id = input<string>();
  /** Bac présélectionné (?bac=…) pour un nouvel équipement. */
  readonly bac = input<string>();

  protected readonly types = Object.entries(EQUIPMENT_TYPES) as [EquipmentType, string][];
  // Chaque champ prend la valeur de la fiche enregistrée quand elle est chargée (modification), puis appartient à la saisie.
  protected readonly name = fromEntity(this.existing, (e) => e.name, '');
  protected readonly type = fromEntity<Equipment, EquipmentType>(
    this.existing,
    (e) => e.type,
    'filter',
  );
  /** Nouvel équipement : le bac de l'URL (?bac=…) est présélectionné. */
  protected readonly tankId = fromEntity(
    this.existing,
    (e) => e.tankId ?? '',
    () => (this.id() ? '' : (this.bac() ?? '')),
  );
  protected readonly brand = fromEntity(this.existing, (e) => e.brand ?? '', '');
  protected readonly model = fromEntity(this.existing, (e) => e.model ?? '', '');
  protected readonly specs = fromEntity(this.existing, (e) => e.specs ?? '', '');
  protected readonly purchaseDate = fromEntity(this.existing, (e) => e.purchaseDate ?? '', '');
  protected readonly warranty = fromEntity(this.existing, (e) => str(e.warrantyMonths), '');
  protected readonly price = fromEntity(this.existing, (e) => str(e.price), '');
  protected readonly notes = fromEntity(this.existing, (e) => e.notes ?? '', '');

  protected async save(): Promise<void> {
    if (!this.name().trim()) return;
    const opt = (s: string) => s.trim() || undefined;
    // Une plage horaire incomplète n'est pas enregistrée.
    const full = <T extends { on: string; off: string }>(s?: T) => (s?.on && s.off ? s : undefined);
    const t = this.type();
    await this.gearRepo.saveEquipment(
      {
        light:
          t === 'light'
            ? {
                ...this.light(),
                schedule: full(this.light().schedule),
                siesta: full(this.light().siesta),
              }
            : undefined,
        filter: t === 'filter' || t === 'pump' ? this.filter() : undefined,
        heater: t === 'heater' ? this.heater() : undefined,
        co2: t === 'co2' ? { ...this.co2(), schedule: full(this.co2().schedule) } : undefined,
        id: this.existing()?.id,
        name: this.name().trim(),
        type: this.type(),
        tankId: this.tankId() || undefined,
        brand: opt(this.brand()),
        model: opt(this.model()),
        specs: opt(this.specs()),
        purchaseDate: opt(this.purchaseDate()),
        warrantyMonths: parseNumber(this.warranty()),
        price: parseNumber(this.price()),
        notes: opt(this.notes()),
      },
      { effective: this.changeDate(), note: this.changeNote() },
    );
    this.location.back();
  }

  protected async remove(): Promise<void> {
    if (!confirm('Supprimer cet équipement ?')) return;
    await this.gearRepo.deleteEquipment(must(this.existing()).id);
    this.location.back();
  }
}

/** Formulaire d'un consommable. */
@Component({
  selector: 'app-consumable-form',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page" style="max-width: 640px">
      <header class="top" style="justify-content: flex-start">
        <button class="iconbtn" type="button" aria-label="Retour" (click)="location.back()"><app-icon name="back" /></button>
        <h1 class="h1 grow">{{ existing() ? 'Modifier' : 'Nouveau consommable' }}</h1>
      </header>
      <form class="stack" style="gap: 16px" (submit)="$event.preventDefault(); save()">
        <div class="form-grid">
          <div class="field full"><label for="name">Nom</label>
            <input id="name" required [value]="name()" (input)="name.set(v($event))" placeholder="Test NO3, engrais NPK…" /></div>
          <div class="field"><label for="cat">Catégorie</label>
            <select id="cat" (change)="category.set($any($event.target).value)">
              @for (c of categories; track c[0]) { <option [value]="c[0]" [selected]="c[0] === category()">{{ c[1] }}</option> }
            </select></div>
          <div class="field"><label for="lvl">Niveau</label>
            <select id="lvl" (change)="level.set($any($event.target).value)">
              @for (l of levels; track l[0]) { <option [value]="l[0]" [selected]="l[0] === level()">{{ l[1] }}</option> }
            </select></div>
          <div class="field full"><label for="brand">Marque</label><input id="brand" [value]="brand()" (input)="brand.set(v($event))" /></div>
          <div class="field"><label for="opened">Ouvert le</label><input id="opened" type="date" [value]="openedDate()" (input)="openedDate.set(v($event))" /></div>
          <div class="field"><label for="exp">Péremption</label><input id="exp" type="date" [value]="expiryDate()" (input)="expiryDate.set(v($event))" /></div>
          <div class="field"><label for="price">Prix (€)</label><input id="price" class="num" inputmode="decimal" [value]="price()" (input)="price.set(v($event))" /></div>
          <div class="field full"><label for="notes">Notes</label>
            <textarea id="notes" [value]="notes()" (input)="notes.set(v($event))" placeholder="Dosage : 1 mL pour 20 L…"></textarea></div>
        </div>
        @if (category() === 'test_kit') {
          <p class="sub" style="margin: 0">Les réactifs de tests en gouttes se dégradent : un test périmé donne des valeurs fausses. Note bien la date de péremption.</p>
        }
        <div class="row" style="gap: 8px; flex-wrap: wrap">
          <button class="btn fill" type="submit" [disabled]="!name().trim()">Enregistrer</button>
          @if (existing()) {
            <button class="btn danger" type="button" (click)="remove()"><app-icon name="trash" [size]="18" />Supprimer</button>
          }
        </div>
      </form>
    </div>
  `,
})
export class ConsumableFormPage {
  protected readonly store = inject(AquariumStore);
  protected readonly gearStore = inject(GearStore);
  protected readonly gearRepo = inject(GearRepo);
  protected readonly location = inject(Location);
  protected readonly v = v;
  readonly id = input<string>();

  protected readonly categories = Object.entries(CONSUMABLE_CATEGORIES) as [
    ConsumableCategory,
    string,
  ][];
  protected readonly levels = Object.entries(STOCK_LEVELS) as [StockLevel, string][];
  protected readonly existing = computed(() =>
    this.gearStore.consumables().find((c) => c.id === this.id()),
  );
  protected readonly name = fromEntity(this.existing, (c) => c.name, '');
  protected readonly category = fromEntity<Consumable, ConsumableCategory>(
    this.existing,
    (c) => c.category,
    'food',
  );
  protected readonly level = fromEntity<Consumable, StockLevel>(
    this.existing,
    (c) => c.level,
    'full',
  );
  protected readonly brand = fromEntity(this.existing, (c) => c.brand ?? '', '');
  protected readonly openedDate = fromEntity(this.existing, (c) => c.openedDate ?? '', '');
  protected readonly expiryDate = fromEntity(this.existing, (c) => c.expiryDate ?? '', '');
  protected readonly price = fromEntity(this.existing, (c) => str(c.price), '');
  protected readonly notes = fromEntity(this.existing, (c) => c.notes ?? '', '');

  protected async save(): Promise<void> {
    if (!this.name().trim()) return;
    const opt = (s: string) => s.trim() || undefined;
    await this.gearRepo.saveConsumable({
      id: this.existing()?.id,
      name: this.name().trim(),
      category: this.category(),
      level: this.level(),
      brand: opt(this.brand()),
      openedDate: opt(this.openedDate()),
      expiryDate: opt(this.expiryDate()),
      price: parseNumber(this.price()),
      notes: opt(this.notes()),
    });
    this.location.back();
  }

  protected async remove(): Promise<void> {
    if (!confirm('Supprimer ce consommable ?')) return;
    await this.gearRepo.deleteConsumable(must(this.existing()).id);
    this.location.back();
  }
}
