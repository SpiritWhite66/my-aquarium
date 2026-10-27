import { DestroyRef, Directive, ElementRef, inject } from '@angular/core';

/** Visible : ni l'attribut hidden, ni display: none, ni visibility: hidden (indépendant de la mise en page). */
function visible(el: HTMLElement): boolean {
  if (el.closest('[hidden]')) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Pour une fenêtre modale : Tab reste dans la fenêtre, et à la fermeture le focus revient
 * à l'élément qui l'avait ouverte.
 */
@Directive({ selector: '[appModal]', host: { '(keydown)': 'onKey($event)' } })
export class ModalFocus {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly opener = document.activeElement as HTMLElement | null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.opener?.isConnected) this.opener.focus();
    });
  }

  protected onKey(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    const items = [...this.el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
    if (!items.length) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === this.el)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
