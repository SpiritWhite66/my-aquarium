import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Location } from '@angular/common';
import { AquariumStore } from '../../core/store';
import type { ConsumableCategory, EquipmentType, StockLevel } from '../../core/models';
import { CONSUMABLE_CATEGORIES, EQUIPMENT_TYPES, STOCK_LEVELS, parseNumber } from '../../core/labels';
import { Icon } from '../../shared/icon';

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
          <div class="field full"><label for="specs">Caractéristiques</label>
            <input id="specs" [value]="specs()" (input)="specs.set(v($event))" placeholder="600 L/h, 50 W…" /></div>
          <div class="field"><label for="bought">Date d’achat</label><input id="bought" type="date" [value]="purchaseDate()" (input)="purchaseDate.set(v($event))" /></div>
          <div class="field"><label for="warranty">Garantie (mois)</label>
            <input id="warranty" class="num" inputmode="numeric" [value]="warranty()" (input)="warranty.set(v($event))" placeholder="24" /></div>
          <div class="field"><label for="price">Prix (€)</label><input id="price" class="num" inputmode="decimal" [value]="price()" (input)="price.set(v($event))" /></div>
          <div class="field full"><label for="notes">Notes</label><textarea id="notes" [value]="notes()" (input)="notes.set(v($event))"></textarea></div>
        </div>
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
export class EquipmentFormPage {
  protected readonly store = inject(AquariumStore);
  protected readonly location = inject(Location);
  protected readonly v = v;
  readonly id = input<string>();

  protected readonly types = Object.entries(EQUIPMENT_TYPES) as [EquipmentType, string][];
  protected readonly name = signal('');
  protected readonly type = signal<EquipmentType>('filter');
  protected readonly tankId = signal('');
  protected readonly brand = signal('');
  protected readonly model = signal('');
  protected readonly specs = signal('');
  protected readonly purchaseDate = signal('');
  protected readonly warranty = signal('');
  protected readonly price = signal('');
  protected readonly notes = signal('');

  protected readonly existing = computed(() => this.store.equipment().find((e) => e.id === this.id()));
  private loaded = false;

  constructor() {
    effect(() => {
      const e = this.existing();
      if (!e || this.loaded) return;
      this.loaded = true;
      this.name.set(e.name);
      this.type.set(e.type);
      this.tankId.set(e.tankId ?? '');
      this.brand.set(e.brand ?? '');
      this.model.set(e.model ?? '');
      this.specs.set(e.specs ?? '');
      this.purchaseDate.set(e.purchaseDate ?? '');
      this.warranty.set(str(e.warrantyMonths));
      this.price.set(str(e.price));
      this.notes.set(e.notes ?? '');
    });
  }

  protected async save(): Promise<void> {
    if (!this.name().trim()) return;
    const opt = (s: string) => s.trim() || undefined;
    await this.store.saveEquipment({
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
    });
    this.location.back();
  }

  protected async remove(): Promise<void> {
    if (!confirm('Supprimer cet équipement ?')) return;
    await this.store.deleteEquipment(this.existing()!.id);
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
  protected readonly location = inject(Location);
  protected readonly v = v;
  readonly id = input<string>();

  protected readonly categories = Object.entries(CONSUMABLE_CATEGORIES) as [ConsumableCategory, string][];
  protected readonly levels = Object.entries(STOCK_LEVELS) as [StockLevel, string][];
  protected readonly name = signal('');
  protected readonly category = signal<ConsumableCategory>('food');
  protected readonly level = signal<StockLevel>('full');
  protected readonly brand = signal('');
  protected readonly openedDate = signal('');
  protected readonly expiryDate = signal('');
  protected readonly price = signal('');
  protected readonly notes = signal('');

  protected readonly existing = computed(() => this.store.consumables().find((c) => c.id === this.id()));
  private loaded = false;

  constructor() {
    effect(() => {
      const c = this.existing();
      if (!c || this.loaded) return;
      this.loaded = true;
      this.name.set(c.name);
      this.category.set(c.category);
      this.level.set(c.level);
      this.brand.set(c.brand ?? '');
      this.openedDate.set(c.openedDate ?? '');
      this.expiryDate.set(c.expiryDate ?? '');
      this.price.set(str(c.price));
      this.notes.set(c.notes ?? '');
    });
  }

  protected async save(): Promise<void> {
    if (!this.name().trim()) return;
    const opt = (s: string) => s.trim() || undefined;
    await this.store.saveConsumable({
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
    await this.store.deleteConsumable(this.existing()!.id);
    this.location.back();
  }
}
