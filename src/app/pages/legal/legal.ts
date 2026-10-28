import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LEGAL } from '../../core/legal';

export type LegalDoc = 'mentions' | 'confidentialite' | 'conditions';

const TITLES: Record<LegalDoc, string> = {
  mentions: 'Mentions légales',
  confidentialite: 'Politique de confidentialité',
  conditions: 'Conditions d’utilisation',
};

/**
 * Textes légaux, écrits par un particulier pour un service gratuit (ADR-0011). Ils décrivent ce que
 * fait le service aujourd’hui : à relire et à faire évoluer à chaque étape qui change les données
 * enregistrées (sauvegarde, synchronisation, photos).
 */
@Component({
  selector: 'app-legal',
  imports: [RouterLink, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    article { display: flex; flex-direction: column; gap: 10px; padding: 16px; line-height: 1.55; }
    h2 { font-size: 16px; margin: 10px 0 0; }
    p, ul { margin: 0; }
    ul { padding-left: 20px; display: flex; flex-direction: column; gap: 4px; }
    nav { display: flex; flex-wrap: wrap; gap: 12px; font-size: 14px; }
  `,
  template: `
    <div class="page" style="max-width: 720px">
      <header class="top">
        <div>
          <h1 class="h1">{{ title() }}</h1>
          <p class="sub">Version {{ version() }} · {{ updated }}</p>
        </div>
      </header>

      <article class="card">
        @switch (doc()) {
          @case ('mentions') {
            <h2>Éditeur</h2>
            <p>Mes aquariums est édité par un particulier, à titre non professionnel. Conformément à l’article 6, III-2 de la loi pour la confiance dans l’économie numérique (LCEN), son identité a été communiquée aux hébergeurs ci-dessous.</p>
            <p>Directeur de la publication : l’éditeur. Contact : <ng-container [ngTemplateOutlet]="contactTpl" /></p>
            <h2>Hébergeurs</h2>
            <ul>
              <li>Application (pages statiques) : GitHub, Inc., 88 Colin P. Kelly Jr Street, San Francisco, CA 94107, États-Unis (GitHub Pages).</li>
              <li>Service en ligne (API) : Render Services, Inc., 525 Brannan Street, Suite 300, San Francisco, CA 94107, États-Unis. Serveurs situés à Francfort (Allemagne).</li>
              <li>Base de données : Neon, serveurs situés à Francfort (Allemagne).</li>
            </ul>
            <h2>Propriété intellectuelle</h2>
            <p>Le code et les contenus de l’application sont ceux de l’éditeur, sauf mention contraire. Les données que tu saisis t’appartiennent.</p>
            <h2>Données personnelles</h2>
            <p>Voir la <a routerLink="/confidentialite">politique de confidentialité</a>.</p>
          }
          @case ('confidentialite') {
            <h2>Qui est responsable de tes données ?</h2>
            <p>L’éditeur de l’application (voir les <a routerLink="/mentions-legales">mentions légales</a>). Contact pour toute question ou demande : <ng-container [ngTemplateOutlet]="contactTpl" /></p>
            <h2>Sans compte</h2>
            <p>Tout reste sur ton appareil : aucune donnée n’est envoyée à un serveur, sauf la demande de mise à jour du catalogue d’espèces si tu l’actives (elle ne contient aucune donnée personnelle).</p>
            <h2>Avec un compte, ce qui est enregistré</h2>
            <ul>
              <li><b>Ton adresse e-mail</b>, pour t’identifier et t’envoyer le lien de connexion.</li>
              <li><b>Tes appareils connectés</b> : nom du navigateur, dates de création et de dernière utilisation, pour que tu puisses les voir et les déconnecter.</li>
              <li><b>Tes acceptations</b> des conditions et de cette politique (version et date).</li>
              <li><b>Des journaux techniques</b> limités (sans e-mail ni contenu), pour la sécurité et le dépannage ; l’adresse IP est traitée par les hébergeurs pour assurer le service et se protéger des abus.</li>
            </ul>
            <p>Pour l’instant, les données de tes aquariums restent sur ton appareil : elles ne sont pas envoyées au serveur. Cette page sera mise à jour avant que cela change.</p>
            <h2>Pourquoi, et sur quelle base légale</h2>
            <ul>
              <li>Fournir le compte et la connexion : exécution du service que tu demandes.</li>
              <li>Sécurité et prévention des abus : intérêt légitime.</li>
              <li>Conserver la preuve de ton acceptation : obligation de pouvoir la démontrer.</li>
            </ul>
            <h2>Combien de temps</h2>
            <ul>
              <li>Compte : jusqu’à ce que tu le supprimes.</li>
              <li>Compte inactif : avertissement par e-mail après 12 mois sans connexion, suppression 30 jours plus tard.</li>
              <li>Lien de connexion : 15 minutes. Appareil connecté : 30 jours après sa dernière utilisation.</li>
              <li>Journaux techniques : 30 jours.</li>
            </ul>
            <h2>Cookies et traceurs</h2>
            <p>Aucun traceur publicitaire ni mesure d’audience. Un seul cookie, strictement nécessaire, garde ta connexion ouverte ; il n’existe que si tu te connectes. L’appli enregistre aussi des réglages sur ton appareil (thème, par exemple).</p>
            <h2>Qui reçoit tes données</h2>
            <p>Nos prestataires techniques, uniquement pour faire fonctionner le service : GitHub (pages de l’appli), Render (API), Neon (base de données) et Brevo (envoi des e-mails de connexion, société française). Certains sont établis aux États-Unis ; les transferts sont encadrés par les garanties prévues par le RGPD. Aucune donnée n’est vendue ni utilisée pour de la publicité.</p>
            <h2>Tes droits</h2>
            <p>Accès, rectification, effacement, limitation, opposition et portabilité de tes données : suppression du compte depuis Réglages › Compte, ou pour tout autre droit écris à l’adresse de contact (réponse sous un mois). Tu peux aussi saisir la CNIL (<a href="https://www.cnil.fr" rel="noopener noreferrer">cnil.fr</a>).</p>
            <h2>Âge</h2>
            <p>Le compte est réservé aux personnes d’au moins 15 ans.</p>
          }
          @case ('conditions') {
            <h2>Objet</h2>
            <p>Mes aquariums t’aide à suivre tes aquariums (relevés, entretien, habitants, matériel). Le service est gratuit et proposé par un particulier.</p>
            <h2>Compte</h2>
            <p>Le compte est facultatif et réservé aux personnes d’au moins 15 ans. Il est personnel. Tu te connectes par un lien envoyé à ton adresse e-mail : garde-la sous ton contrôle.</p>
            <h2>Un outil d’aide, pas un conseil</h2>
            <p>Les fiches d’espèces, rappels et analyses sont des repères indicatifs. Ils ne remplacent ni l’observation de tes animaux ni l’avis d’un professionnel ou d’un vétérinaire. Tu restes responsable de tes décisions.</p>
            <h2>Disponibilité</h2>
            <p>Le service est fourni sans garantie de disponibilité ni de conservation. Exporte régulièrement tes données depuis les réglages : la sauvegarde est à ta main.</p>
            <h2>Comportement</h2>
            <p>Tu t’engages à ne pas perturber le service, ni tenter d’accéder aux données d’autres personnes. Un compte peut être suspendu en cas d’abus.</p>
            <h2>Fin du compte</h2>
            <p>Tu peux supprimer ton compte à tout moment depuis Réglages › Compte (ou en écrivant à l’adresse de contact). Les comptes inactifs sont supprimés comme indiqué dans la <a routerLink="/confidentialite">politique de confidentialité</a>.</p>
            <h2>Responsabilité</h2>
            <p>Dans la limite permise par la loi, l’éditeur n’est pas responsable des pertes de données ni des dommages indirects liés à l’usage du service.</p>
            <h2>Évolution et droit applicable</h2>
            <p>Ces conditions peuvent évoluer : en cas de changement important, une nouvelle acceptation te sera demandée. Elles sont régies par le droit français.</p>
            <h2>Contact</h2>
            <p><ng-container [ngTemplateOutlet]="contactTpl" /></p>
          }
        }
      </article>

      <nav aria-label="Autres textes">
        @if (doc() !== 'mentions') { <a routerLink="/mentions-legales">Mentions légales</a> }
        @if (doc() !== 'confidentialite') { <a routerLink="/confidentialite">Confidentialité</a> }
        @if (doc() !== 'conditions') { <a routerLink="/conditions">Conditions d’utilisation</a> }
      </nav>
    </div>

    <ng-template #contactTpl>
      @if (contact) {
        <a [href]="'mailto:' + contact">{{ contact }}</a>
      } @else {
        <em>adresse de contact à renseigner</em>
      }
    </ng-template>
  `,
})
export class LegalPage {
  /** Texte affiché, fixé par la route. */
  readonly doc = input<LegalDoc>('mentions');
  protected readonly title = computed(() => TITLES[this.doc()]);
  protected readonly version = computed(() =>
    this.doc() === 'conditions'
      ? LEGAL.versions.cgu
      : this.doc() === 'confidentialite'
        ? LEGAL.versions.confidentialite
        : '1',
  );
  protected readonly updated = LEGAL.updated;
  protected readonly contact = LEGAL.contactEmail;
}
