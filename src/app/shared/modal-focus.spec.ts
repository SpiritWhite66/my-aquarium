import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ModalFocus } from './modal-focus';

@Component({
  imports: [ModalFocus],
  template: `
    <button id="opener">Ouvrir</button>
    @if (open()) {
      <div id="dialog" appModal tabindex="-1">
        <button id="first">Premier</button>
        <input id="middle" />
        <button id="hidden" style="display: none">Caché</button>
        <button id="off" disabled>Désactivé</button>
        <a id="last" href="#x">Dernier</a>
      </div>
    }
  `,
})
class Host {
  open = signal(false);
}

afterEach(() => TestBed.resetTestingModule());

function setup() {
  const fixture = TestBed.createComponent(Host);
  document.body.append(fixture.nativeElement);
  fixture.detectChanges();
  const q = <T extends HTMLElement>(id: string) => fixture.nativeElement.querySelector(`#${id}`) as T;
  const open = () => {
    q('opener').focus();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
  };
  const tab = (shift = false) => {
    const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
    (document.activeElement ?? document.body).dispatchEvent(e);
    return e;
  };
  return { fixture, q, open, tab };
}

describe('fenêtre modale', () => {
  it('Tab depuis le dernier élément revient au premier', () => {
    const { q, open, tab } = setup();
    open();
    q('last').focus();
    const e = tab();
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(q('first'));
  });

  it('Maj+Tab depuis le premier élément va au dernier', () => {
    const { q, open, tab } = setup();
    open();
    q('first').focus();
    expect(tab(true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(q('last'));
  });

  it('Maj+Tab depuis la fenêtre elle-même va au dernier élément', () => {
    const { q, open, tab } = setup();
    open();
    q('dialog').focus();
    expect(tab(true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(q('last'));
  });

  it('laisse Tab suivre son cours entre les deux', () => {
    const { q, open, tab } = setup();
    open();
    q('middle').focus();
    expect(tab().defaultPrevented).toBe(false);
    expect(tab(true).defaultPrevented).toBe(false);
    q('first').focus();
    expect(tab().defaultPrevented).toBe(false);
    q('last').focus();
    expect(tab(true).defaultPrevented).toBe(false);
  });

  it('ignore les autres touches', () => {
    const { q, open } = setup();
    open();
    q('last').focus();
    const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    q('last').dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(q('last'));
  });

  it('ne compte ni les éléments cachés ni désactivés', () => {
    const { q, open, tab } = setup();
    open();
    q('last').focus();
    tab();
    expect(document.activeElement?.id).toBe('first');
    q('middle').focus();
    expect(tab().defaultPrevented).toBe(false);
  });

  it('rend le focus à l’élément qui avait ouvert la fenêtre', () => {
    const { fixture, q, open } = setup();
    open();
    q('middle').focus();
    expect(document.activeElement?.id).toBe('middle');
    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    expect(document.activeElement?.id).toBe('opener');
  });

  it('ne rend pas le focus à un élément qui n’est plus dans la page', () => {
    const { fixture, q, open } = setup();
    open();
    q('opener').remove();
    q('middle').focus();
    fixture.componentInstance.open.set(false);
    expect(() => fixture.detectChanges()).not.toThrow();
  });

  it('une fenêtre sans aucun élément focalisable garde le focus', () => {
    @Component({ imports: [ModalFocus], template: `<div appModal tabindex="-1" id="empty"><p>Texte</p></div>` })
    class Empty {}
    const fixture = TestBed.createComponent(Empty);
    document.body.append(fixture.nativeElement);
    fixture.detectChanges();
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    fixture.nativeElement.querySelector('#empty').dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });
});
