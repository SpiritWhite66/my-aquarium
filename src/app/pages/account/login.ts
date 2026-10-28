import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService, type LinkResult } from '../../core/auth';

type Step = 'form' | 'sending' | 'sent' | 'checking' | 'consent' | 'invalid' | 'error';

const LINK_ERRORS: Record<Exclude<LinkResult, 'sent'>, string> = {
  invalid: 'Cette adresse e-mail ne semble pas valide.',
  limited: 'Trop de demandes pour le moment. Réessaie dans un moment.',
  unavailable: 'Le service d’envoi d’e-mails n’est pas disponible pour l’instant.',
  error: 'Le serveur ne répond pas. Vérifie ta connexion puis réessaie.',
};

@Component({
  selector: 'app-login',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .box { display: flex; flex-direction: column; gap: 14px; padding: 16px; }
    .err { color: var(--dg); font-size: 14px; }
    .consent { display: flex; flex-direction: column; gap: 4px; }
    .consent .check { font-weight: 500; font-size: 14px; align-items: flex-start; }
  `,
  template: `
    <div class="page" style="max-width: 560px">
      <header class="top"><h1 class="h1">Connexion</h1></header>

      @if (!auth.available) {
        <section class="card box">
          <p>Les comptes ne sont pas encore ouverts. L’appli fonctionne très bien sans.</p>
          <a class="btn ton" routerLink="/">Retour à l’accueil</a>
        </section>
      } @else if (auth.user(); as user) {
        <section class="card box">
          <p>Tu es connecté avec <b>{{ user.email }}</b>.</p>
          <a class="btn ton" routerLink="/reglages">Aller aux réglages</a>
        </section>
      } @else {
        @switch (step()) {
          @case ('checking') {
            <section class="card box" aria-live="polite"><p>Vérification du lien…</p></section>
          }
          @case ('consent') {
            <section class="card box">
              <p>Bienvenue ! Pour créer ton compte, accepte les conditions ci-dessous.</p>
              <div class="consent">
                <label class="check">
                  <input type="checkbox" [checked]="terms()" (change)="terms.set($any($event.target).checked)" />
                  <span>J’accepte les <a routerLink="/conditions">conditions d’utilisation</a> et j’ai lu la <a routerLink="/confidentialite">politique de confidentialité</a>.</span>
                </label>
                <label class="check">
                  <input type="checkbox" [checked]="age15()" (change)="age15.set($any($event.target).checked)" />
                  <span>J’ai au moins 15 ans.</span>
                </label>
              </div>
              <button class="btn fill" type="button" [disabled]="!terms() || !age15()" (click)="accept()">Créer mon compte</button>
            </section>
          }
          @case ('invalid') {
            <section class="card box">
              <p class="err" role="alert">Ce lien n’est plus valable : il expire au bout de 15 minutes et ne sert qu’une fois.</p>
              <a class="btn ton" routerLink="/connexion">Recevoir un nouveau lien</a>
            </section>
          }
          @case ('sent') {
            <section class="card box" aria-live="polite">
              <p>C’est parti ! Consulte tes e-mails : un lien de connexion t’attend (pense aux courriers indésirables). Il est valable 15 minutes.</p>
              <button class="linkbtn" type="button" (click)="step.set('form')">Utiliser une autre adresse</button>
            </section>
          }
          @default {
            <section class="card box">
              <p>Un compte sert à retrouver tes données sur plusieurs appareils. Pas de mot de passe : tu reçois un lien par e-mail. L’appli reste utilisable sans compte.</p>
              <form class="box" style="padding: 0" (submit)="send($event)">
                <div class="field">
                  <label for="email">Adresse e-mail</label>
                  <input id="email" type="email" autocomplete="email" inputmode="email" required [value]="email()" (input)="email.set($any($event.target).value)" />
                </div>
                @if (message(); as m) { <p class="err" role="alert">{{ m }}</p> }
                <button class="btn fill" type="submit" [disabled]="step() === 'sending' || !email().trim()">{{ step() === 'sending' ? 'Envoi…' : 'Recevoir un lien de connexion' }}</button>
              </form>
              <p class="sub" style="margin: 0">En continuant, tu pourras consulter les <a routerLink="/conditions">conditions d’utilisation</a> et la <a routerLink="/confidentialite">politique de confidentialité</a>.</p>
            </section>
          }
        }
      }
    </div>
  `,
})
export class LoginPage {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Lien reçu par e-mail (`?token=…`), lié par le routeur. */
  readonly token = input<string>();

  protected readonly step = signal<Step>('form');
  protected readonly email = signal('');
  protected readonly message = signal('');
  protected readonly terms = signal(false);
  protected readonly age15 = signal(false);

  private checked: string | undefined;

  constructor() {
    effect(() => {
      const token = this.token();
      if (token === undefined || !this.auth.available || token === this.checked) return;
      this.checked = token;
      untracked(() => void this.check(token));
    });
  }

  protected async send(event: Event): Promise<void> {
    event.preventDefault();
    this.message.set('');
    this.step.set('sending');
    const result = await this.auth.requestLink(this.email().trim());
    if (result === 'sent') {
      this.step.set('sent');
    } else {
      this.message.set(LINK_ERRORS[result]);
      this.step.set('form');
    }
  }

  private async check(token: string, consent = false): Promise<void> {
    this.step.set('checking');
    const result = await this.auth.verify(
      token,
      consent ? { terms: true, age15: true } : undefined,
    );
    switch (result) {
      case 'ok':
        // Le lien secret quitte l'adresse affichée et l'historique.
        await this.router.navigate(['/reglages'], { replaceUrl: true });
        break;
      case 'consent_required':
        this.step.set('consent');
        break;
      case 'invalid':
        this.step.set('invalid');
        break;
      default:
        this.message.set(LINK_ERRORS.error);
        this.step.set('form');
    }
  }

  protected accept(): void {
    const token = this.token();
    if (token !== undefined && this.terms() && this.age15()) void this.check(token, true);
  }
}
