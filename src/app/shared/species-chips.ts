import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Species } from '../core/models';
import { LIGHTS, PLACEMENTS, ZONES } from '../core/labels';

interface Chip {
  text: string;
  tone: '' | 'p' | 'w' | 'r' | 'o';
}

/** Badges courts d'une espèce : placement, lumière, CO2, banc, « mange les plantes »… */
export function speciesChips(s: Species): Chip[] {
  const chips: Chip[] = [];
  const fl = s.flora;
  if (fl) {
    chips.push({ text: PLACEMENTS[fl.placement], tone: '' });
    if (fl.co2 === 'required') chips.push({ text: 'CO2 requis', tone: 'w' });
    else if (fl.co2 === 'beneficial') chips.push({ text: 'CO2 conseillé', tone: 'w' });
    chips.push({ text: `Lumière ${LIGHTS[fl.light].toLowerCase()}`, tone: fl.light === 'high' ? 'o' : '' });
  }
  const fa = s.fauna;
  if (fa) {
    if (fa.minGroup && fa.minGroup > 1) chips.push({ text: `Groupe ≥ ${fa.minGroup}`, tone: '' });
    chips.push({ text: ZONES[fa.zone], tone: '' });
    if (fa.role) chips.push({ text: fa.role, tone: 'p' });
    if (fa.eatsPlants) chips.push({ text: 'Mange les plantes', tone: 'r' });
    if (fa.predation?.includes('shrimp')) chips.push({ text: 'Chasse les crevettes', tone: 'r' });
    else if (fa.predation?.includes('shrimp_fry')) chips.push({ text: 'Mange les jeunes crevettes', tone: 'o' });
  }
  return chips;
}

@Component({
  selector: 'app-species-chips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chips">
      @for (c of chips(); track c.text) {
        <span class="chip" [class]="c.tone">{{ c.text }}</span>
      }
    </div>
  `,
})
export class SpeciesChips {
  readonly species = input.required<Species>();
  readonly max = input(4);
  protected readonly chips = computed(() => speciesChips(this.species()).slice(0, this.max()));
}
