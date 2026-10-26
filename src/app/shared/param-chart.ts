import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ParamKey, Range, WaterTest } from '../core/models';
import { levelOf } from '../core/rules';
import { fmt } from '../core/labels';

const W = 320;
const H = 96;
const PAD_X = 10;
const PAD_Y = 8;

/** Courbe d'un paramètre avec la plage idéale en bande colorée (dessin SVG léger, sans bibliothèque). */
@Component({
  selector: 'app-param-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    svg { display: block; width: 100%; height: auto; margin-top: 6px; overflow: visible; }
    .band { fill: var(--okb); }
    .line { fill: none; stroke: var(--wa); stroke-width: 2; vector-effect: non-scaling-stroke; }
    .pt { fill: var(--sf); stroke: var(--wa); stroke-width: 2; }
    .pt.bad { fill: var(--dg); stroke: var(--dg); }
    .ax { font: 500 10px var(--mono); fill: var(--mu); }
    .tick { stroke: var(--pl); stroke-width: 2; vector-effect: non-scaling-stroke; }
    .mark { stroke: var(--mu); stroke-width: 1; stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
  `,
  template: `
    @let c = chart();
    <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="c.label">
      @if (c.band) {
        <rect class="band" x="0" [attr.y]="c.band.y" [attr.width]="W" [attr.height]="c.band.h" rx="4" />
        <text class="ax" x="2" [attr.y]="c.band.y - 3">{{ c.band.top }}</text>
        <text class="ax" x="2" [attr.y]="c.band.y + c.band.h + 11">{{ c.band.bottom }}</text>
      }
      @for (m of c.marks; track $index) {
        <line class="mark" [attr.x1]="m.x" [attr.x2]="m.x" y1="0" [attr.y2]="H"><title>{{ m.label }}</title></line>
      }
      @for (t of c.ticks; track $index) {
        <line class="tick" [attr.x1]="t.x" [attr.x2]="t.x" [attr.y1]="H - 6" [attr.y2]="H"><title>{{ t.label }}</title></line>
      }
      @if (c.points.length > 1) {
        <polyline class="line" [attr.points]="c.polyline" />
      }
      @for (p of c.points; track $index; let last = $last) {
        <circle class="pt" [class.bad]="p.bad" [attr.cx]="p.x" [attr.cy]="p.y" [attr.r]="last || p.bad ? 4.5 : 3.5" />
      }
    </svg>
  `,
})
export class ParamChart {
  protected readonly W = W;
  protected readonly H = H;

  readonly key = input.required<ParamKey>();
  readonly tests = input.required<WaterTest[]>();
  readonly range = input<Range>();
  readonly label = input('');
  /** Changements de réglage à repérer sur la courbe (trait vertical). */
  readonly marks = input<{ date: string; label: string }[]>([]);
  /** Doses d'engrais : petits traits en bas de la courbe. */
  readonly ticks = input<{ date: string; label: string }[]>([]);

  protected readonly chart = computed(() => {
    const key = this.key();
    const range = this.range();
    const data = this.tests()
      .filter((t) => t.values[key] != null)
      .slice(-12)
      .map((t) => ({ time: new Date(t.date).getTime(), value: t.values[key]! }));

    const values = data.map((d) => d.value);
    if (range) values.push(range.min, range.max);
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const margin = (hi - lo) * 0.15;
    lo -= margin;
    hi += margin;
    const y = (v: number) => PAD_Y + (1 - (v - lo) / (hi - lo)) * (H - 2 * PAD_Y);

    const t0 = data[0]?.time ?? 0;
    const t1 = data.at(-1)?.time ?? 1;
    const x = (t: number, i: number) =>
      t1 === t0 ? PAD_X + (i * (W - 2 * PAD_X)) / Math.max(data.length - 1, 1) : PAD_X + ((t - t0) / (t1 - t0)) * (W - 2 * PAD_X);

    const points = data.map((d, i) => ({
      x: +x(d.time, i).toFixed(1),
      y: +y(d.value).toFixed(1),
      bad: levelOf(key, d.value, range) !== 'ok',
    }));
    const band = range
      ? { y: y(range.max), h: Math.max(y(range.min) - y(range.max), 2), top: fmt(range.max), bottom: fmt(range.min) }
      : undefined;
    const last = data.at(-1);
    const marks = data.length > 1
      ? this.marks()
          .map((m) => ({ t: new Date(m.date).getTime(), label: m.label }))
          .filter((m) => m.t > t0 && m.t <= t1)
          .map((m) => ({ x: +x(m.t, 0).toFixed(1), label: m.label }))
      : [];
    const ticks = data.length > 1
      ? this.ticks()
          .map((m) => ({ t: new Date(m.date).getTime(), label: m.label }))
          .filter((m) => m.t > t0 && m.t <= t1)
          .map((m) => ({ x: +x(m.t, 0).toFixed(1), label: m.label }))
      : [];
    return {
      ticks,
      marks,
      points,
      polyline: points.map((p) => `${p.x},${p.y}`).join(' '),
      band,
      label: `${this.label()} : ${data.length} relevés${last ? `, dernier ${fmt(last.value)}` : ''}`,
    };
  });
}
