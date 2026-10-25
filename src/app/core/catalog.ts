import type { FaunaInfo, FloraInfo, Range, Species, SpeciesKind } from './models';

// Catalogue de départ. Les valeurs sont des plages usuelles en aquariophilie,
// à affiner au besoin depuis l'app (fiches personnelles).
// Les identifiants sont stables : ils servent à mettre à jour le catalogue sans toucher aux données.

const CATALOG_DATE = '2026-10-25T00:00:00.000Z';

interface Seed {
  id: string;
  kind: SpeciesKind;
  sci: string;
  names: string[];
  difficulty?: Species['difficulty'];
  temp?: [number, number];
  ph?: [number, number];
  gh?: [number, number];
  kh?: [number, number];
  fauna?: FaunaInfo;
  flora?: FloraInfo;
  notes?: string;
}

const r = (v?: [number, number]): Range | undefined => (v ? { min: v[0], max: v[1] } : undefined);

const SEEDS: Seed[] = [
  // ---------- Poissons ----------
  {
    id: 'danio-margaritatus', kind: 'fish', sci: 'Danio margaritatus', names: ['Rasbora galaxy', 'Danio margaritatus'],
    difficulty: 'easy', temp: [20, 26], ph: [6.5, 7.5], gh: [5, 15], kh: [2, 10],
    fauna: { adultSizeCm: 2.5, minGroup: 10, minTankLiters: 40, temperament: 'peaceful', zone: 'middle', diet: 'omnivore', predation: ['shrimp_fry'] },
    notes: 'Craintif, apprécie un bac très planté. Peut chasser quelques larves de crevettes.',
  },
  {
    id: 'apistogramma-borellii', kind: 'fish', sci: 'Apistogramma borellii', names: ['Apistogramma borelli'],
    difficulty: 'medium', temp: [22, 26], ph: [6, 7.5], gh: [2, 12], kh: [1, 8],
    fauna: { adultSizeCm: 7, minGroup: 2, minTankLiters: 60, temperament: 'semi-aggressive', zone: 'bottom', diet: 'carnivore', predation: ['shrimp_fry'] },
    notes: 'Cichlidé nain, territorial en période de reproduction. Mange volontiers les jeunes crevettes ; des mousses denses les protègent.',
  },
  {
    id: 'paracheirodon-innesi', kind: 'fish', sci: 'Paracheirodon innesi', names: ['Néon bleu'],
    difficulty: 'easy', temp: [20, 26], ph: [5, 7.5], gh: [1, 12], kh: [1, 8],
    fauna: { adultSizeCm: 3.5, minGroup: 10, minTankLiters: 54, temperament: 'peaceful', zone: 'middle', diet: 'omnivore' },
  },
  {
    id: 'paracheirodon-axelrodi', kind: 'fish', sci: 'Paracheirodon axelrodi', names: ['Néon cardinal'],
    difficulty: 'medium', temp: [23, 29], ph: [4.5, 7], gh: [1, 8], kh: [0, 4],
    fauna: { adultSizeCm: 4, minGroup: 10, minTankLiters: 60, temperament: 'peaceful', zone: 'middle', diet: 'omnivore' },
  },
  {
    id: 'hemigrammus-erythrozonus', kind: 'fish', sci: 'Hemigrammus erythrozonus', names: ['Tétra lumineux'],
    difficulty: 'easy', temp: [24, 28], ph: [5.5, 7.5], gh: [2, 15], kh: [1, 8],
    fauna: { adultSizeCm: 4, minGroup: 8, minTankLiters: 54, temperament: 'peaceful', zone: 'middle', diet: 'omnivore' },
  },
  {
    id: 'boraras-brigittae', kind: 'fish', sci: 'Boraras brigittae', names: ['Rasbora moustique'],
    difficulty: 'medium', temp: [24, 28], ph: [4, 7], gh: [1, 10], kh: [0, 5],
    fauna: { adultSizeCm: 2, minGroup: 12, minTankLiters: 25, temperament: 'peaceful', zone: 'middle', diet: 'omnivore' },
  },
  {
    id: 'trigonostigma-heteromorpha', kind: 'fish', sci: 'Trigonostigma heteromorpha', names: ['Rasbora arlequin'],
    difficulty: 'easy', temp: [22, 27], ph: [6, 7.5], gh: [2, 12], kh: [1, 8],
    fauna: { adultSizeCm: 4.5, minGroup: 10, minTankLiters: 60, temperament: 'peaceful', zone: 'middle', diet: 'omnivore' },
  },
  {
    id: 'corydoras-aeneus', kind: 'fish', sci: 'Corydoras aeneus', names: ['Corydoras bronze'],
    difficulty: 'easy', temp: [22, 26], ph: [6, 8], gh: [2, 20], kh: [2, 12],
    fauna: { adultSizeCm: 7, minGroup: 6, minTankLiters: 80, temperament: 'peaceful', zone: 'bottom', diet: 'omnivore', role: 'Fouille le sol' },
    notes: 'Préfère un sable fin pour ne pas abîmer ses barbillons.',
  },
  {
    id: 'corydoras-pygmaeus', kind: 'fish', sci: 'Corydoras pygmaeus', names: ['Corydoras pygmée'],
    difficulty: 'easy', temp: [22, 26], ph: [6, 7.5], gh: [2, 15], kh: [2, 10],
    fauna: { adultSizeCm: 2.5, minGroup: 8, minTankLiters: 40, temperament: 'peaceful', zone: 'all', diet: 'omnivore' },
  },
  {
    id: 'otocinclus-vittatus', kind: 'fish', sci: 'Otocinclus vittatus', names: ['Otocinclus'],
    difficulty: 'medium', temp: [20, 26], ph: [6, 7.5], gh: [2, 15], kh: [2, 10],
    fauna: { adultSizeCm: 4, minGroup: 5, minTankLiters: 60, temperament: 'peaceful', zone: 'all', diet: 'herbivore', role: 'Mange les algues' },
    notes: 'Mange les algues sans abîmer les plantes. À introduire dans un bac mature.',
  },
  {
    id: 'ancistrus-sp', kind: 'fish', sci: 'Ancistrus sp.', names: ['Ancistrus', 'Pléco bristlenose'],
    difficulty: 'easy', temp: [22, 27], ph: [6, 7.5], gh: [2, 20], kh: [2, 12],
    fauna: { adultSizeCm: 13, minGroup: 1, minTankLiters: 100, temperament: 'peaceful', zone: 'bottom', diet: 'herbivore', role: 'Mange les algues' },
    notes: 'A besoin de bois à racler.',
  },
  {
    id: 'betta-splendens', kind: 'fish', sci: 'Betta splendens', names: ['Combattant'],
    difficulty: 'easy', temp: [24, 28], ph: [6, 7.5], gh: [2, 15], kh: [1, 10],
    fauna: { adultSizeCm: 6, minGroup: 1, minTankLiters: 25, temperament: 'semi-aggressive', zone: 'top', diet: 'carnivore', predation: ['shrimp_fry', 'shrimp'] },
    notes: 'Un seul mâle par bac. Peut s’en prendre aux crevettes.',
  },
  {
    id: 'poecilia-reticulata', kind: 'fish', sci: 'Poecilia reticulata', names: ['Guppy'],
    difficulty: 'easy', temp: [22, 28], ph: [7, 8.5], gh: [8, 20], kh: [4, 15],
    fauna: { adultSizeCm: 5, minGroup: 3, minTankLiters: 54, temperament: 'peaceful', zone: 'top', diet: 'omnivore', predation: ['shrimp_fry'] },
  },
  {
    id: 'metynnis-argenteus', kind: 'fish', sci: 'Metynnis argenteus', names: ['Dollar d’argent'],
    difficulty: 'medium', temp: [24, 28], ph: [5, 7], gh: [2, 15], kh: [1, 8],
    fauna: { adultSizeCm: 14, minGroup: 5, minTankLiters: 300, temperament: 'peaceful', zone: 'middle', diet: 'herbivore', eatsPlants: true },
    notes: 'Dévore la plupart des plantes : réservé aux bacs sans plantes tendres.',
  },

  // ---------- Crevettes ----------
  {
    id: 'neocaridina-davidi', kind: 'shrimp', sci: 'Neocaridina davidi', names: ['Red Cherry', 'Crevette Neocaridina'],
    difficulty: 'easy', temp: [18, 27], ph: [6.5, 8], gh: [6, 15], kh: [2, 10],
    fauna: { adultSizeCm: 2.5, minGroup: 10, minTankLiters: 20, temperament: 'peaceful', zone: 'bottom', diet: 'omnivore', role: 'Nettoyeuse' },
    notes: 'Se reproduit facilement. Sensible au cuivre et aux variations brusques.',
  },
  {
    id: 'caridina-multidentata', kind: 'shrimp', sci: 'Caridina multidentata', names: ['Crevette Amano'],
    difficulty: 'easy', temp: [20, 28], ph: [6, 8], gh: [5, 15], kh: [2, 10],
    fauna: { adultSizeCm: 5, minGroup: 5, minTankLiters: 40, temperament: 'peaceful', zone: 'bottom', diet: 'omnivore', role: 'Mange les algues' },
    notes: 'Ne se reproduit pas en eau douce.',
  },

  // ---------- Escargots ----------
  {
    id: 'neritina-natalensis', kind: 'snail', sci: 'Neritina natalensis', names: ['Nérite zèbre', 'Neritina'],
    difficulty: 'easy', temp: [22, 28], ph: [7, 8.5], gh: [8, 18], kh: [4, 12],
    fauna: { adultSizeCm: 2.5, minGroup: 1, minTankLiters: 20, temperament: 'peaceful', zone: 'all', diet: 'herbivore', role: 'Vitres et algues' },
    notes: 'Ne se reproduit pas en eau douce (œufs blancs sur le décor). Une eau trop douce abîme sa coquille.',
  },
  {
    id: 'clithon-corona', kind: 'snail', sci: 'Clithon corona', names: ['Néritine couronnée'],
    difficulty: 'easy', temp: [22, 28], ph: [7, 8.5], gh: [8, 18], kh: [4, 12],
    fauna: { adultSizeCm: 2, minGroup: 1, minTankLiters: 20, temperament: 'peaceful', zone: 'all', diet: 'herbivore', role: 'Vitres' },
  },
  {
    id: 'planorbella-duryi', kind: 'snail', sci: 'Planorbella duryi', names: ['Planorbe rouge'],
    difficulty: 'easy', temp: [20, 28], ph: [7, 8.5], gh: [6, 18], kh: [3, 12],
    fauna: { adultSizeCm: 2, minGroup: 1, minTankLiters: 10, temperament: 'peaceful', zone: 'all', diet: 'omnivore', role: 'Nettoyeur' },
    notes: 'Se reproduit vite si la nourriture abonde.',
  },

  // ---------- Plantes ----------
  {
    id: 'anubias-barteri-nana', kind: 'plant', sci: 'Anubias barteri var. nana', names: ['Anubias nana'],
    difficulty: 'easy', temp: [22, 28], ph: [6, 7.5], gh: [2, 15],
    flora: { light: 'low', co2: 'none', growth: 'slow', placement: 'epiphyte', form: 'rhizome', propagation: ['Division du rhizome'], maxHeightCm: 10 },
    notes: 'À attacher sur une roche ou un bois : ne pas enterrer le rhizome.',
  },
  {
    id: 'microsorum-pteropus', kind: 'plant', sci: 'Microsorum pteropus', names: ['Fougère de Java'],
    difficulty: 'easy', temp: [20, 28], ph: [6, 7.5], gh: [2, 15],
    flora: { light: 'low', co2: 'none', growth: 'slow', placement: 'epiphyte', form: 'rhizome', propagation: ['Plantules sur les feuilles', 'Division du rhizome'], maxHeightCm: 30 },
  },
  {
    id: 'bucephalandra-sp', kind: 'plant', sci: 'Bucephalandra sp.', names: ['Bucephalandra'],
    difficulty: 'easy', temp: [22, 28], ph: [6, 7.5], gh: [2, 12],
    flora: { light: 'low', co2: 'beneficial', growth: 'slow', placement: 'epiphyte', form: 'rhizome', propagation: ['Division du rhizome'], maxHeightCm: 10 },
  },
  {
    id: 'taxiphyllum-barbieri', kind: 'plant', sci: 'Taxiphyllum barbieri', names: ['Mousse de Java'],
    difficulty: 'easy', temp: [18, 28], ph: [5.5, 8], gh: [2, 15],
    flora: { light: 'low', co2: 'none', growth: 'medium', placement: 'epiphyte', form: 'mousse', propagation: ['Division'], maxHeightCm: 5 },
    notes: 'Abri idéal pour les jeunes crevettes.',
  },
  {
    id: 'cryptocoryne-wendtii', kind: 'plant', sci: 'Cryptocoryne wendtii', names: ['Cryptocoryne'],
    difficulty: 'easy', temp: [20, 28], ph: [6, 8], gh: [2, 15],
    flora: { light: 'low', co2: 'none', growth: 'slow', placement: 'midground', form: 'rosette', propagation: ['Stolons'], maxHeightCm: 15 },
    notes: 'Peut « fondre » après plantation, puis repart.',
  },
  {
    id: 'cryptocoryne-parva', kind: 'plant', sci: 'Cryptocoryne parva', names: ['Cryptocoryne parva'],
    difficulty: 'medium', temp: [20, 28], ph: [6, 7.5], gh: [2, 15],
    flora: { light: 'medium', co2: 'beneficial', growth: 'slow', placement: 'foreground', form: 'rosette', propagation: ['Stolons'], maxHeightCm: 5 },
  },
  {
    id: 'echinodorus-bleheri', kind: 'plant', sci: 'Echinodorus grisebachii « Bleheri »', names: ['Échinodorus', 'Plante épée'],
    difficulty: 'easy', temp: [22, 28], ph: [6, 7.5], gh: [2, 15],
    flora: { light: 'medium', co2: 'none', growth: 'medium', placement: 'background', form: 'rosette', propagation: ['Hampe florale (plantules)'], maxHeightCm: 50 },
    notes: 'Gourmande : apprécie des capsules d’engrais au pied.',
  },
  {
    id: 'vallisneria-spiralis', kind: 'plant', sci: 'Vallisneria spiralis', names: ['Vallisnérie'],
    difficulty: 'easy', temp: [18, 28], ph: [6.5, 8], gh: [4, 18],
    flora: { light: 'low', co2: 'none', growth: 'fast', placement: 'background', form: 'rosette', propagation: ['Stolons'], maxHeightCm: 60 },
  },
  {
    id: 'hygrophila-polysperma', kind: 'plant', sci: 'Hygrophila polysperma', names: ['Hygrophila'],
    difficulty: 'easy', temp: [20, 28], ph: [6, 8], gh: [2, 15],
    flora: { light: 'low', co2: 'none', growth: 'fast', placement: 'background', form: 'tige', propagation: ['Bouturage'], maxHeightCm: 40 },
  },
  {
    id: 'limnophila-sessiliflora', kind: 'plant', sci: 'Limnophila sessiliflora', names: ['Limnophile'],
    difficulty: 'easy', temp: [22, 28], ph: [5.5, 7.5], gh: [2, 15],
    flora: { light: 'medium', co2: 'beneficial', growth: 'fast', placement: 'background', form: 'tige', propagation: ['Bouturage'], maxHeightCm: 40 },
  },
  {
    id: 'rotala-rotundifolia', kind: 'plant', sci: 'Rotala rotundifolia', names: ['Rotala'],
    difficulty: 'easy', temp: [20, 28], ph: [5.5, 7.5], gh: [2, 12],
    flora: { light: 'high', co2: 'beneficial', growth: 'fast', placement: 'background', form: 'tige', propagation: ['Bouturage'], maxHeightCm: 40 },
    notes: 'Rougit sous une lumière forte. Tailler régulièrement et replanter les têtes.',
  },
  {
    id: 'ludwigia-repens-rubin', kind: 'plant', sci: 'Ludwigia repens « Rubin »', names: ['Ludwigia rouge'],
    difficulty: 'easy', temp: [20, 28], ph: [5.5, 7.5], gh: [2, 15],
    flora: { light: 'high', co2: 'beneficial', growth: 'medium', placement: 'background', form: 'tige', propagation: ['Bouturage'], maxHeightCm: 40 },
  },
  {
    id: 'micranthemum-tweediei', kind: 'plant', sci: 'Micranthemum tweediei', names: ['Monte Carlo'],
    difficulty: 'medium', temp: [20, 28], ph: [5.5, 7.5], gh: [2, 12],
    flora: { light: 'medium', co2: 'beneficial', growth: 'medium', placement: 'foreground', form: 'gazon', propagation: ['Stolons', 'Division'], maxHeightCm: 3 },
  },
  {
    id: 'hemianthus-callitrichoides', kind: 'plant', sci: 'Hemianthus callitrichoides', names: ['HC Cuba'],
    difficulty: 'hard', temp: [20, 26], ph: [5.5, 7.5], gh: [2, 12],
    flora: { light: 'high', co2: 'required', growth: 'medium', placement: 'foreground', form: 'gazon', propagation: ['Division', 'Stolons'], maxHeightCm: 2 },
  },
  {
    id: 'limnobium-laevigatum', kind: 'plant', sci: 'Limnobium laevigatum', names: ['Grenouillette'],
    difficulty: 'easy', temp: [18, 28], ph: [6, 8], gh: [2, 18],
    flora: { light: 'low', co2: 'none', growth: 'fast', placement: 'floating', form: 'rosette', propagation: ['Stolons'] },
    notes: 'Absorbe beaucoup de nitrates. Retirer l’excédent chaque semaine.',
  },
];

export const BUILTIN_SPECIES: Species[] = SEEDS.map((s) => ({
  id: s.id,
  updatedAt: CATALOG_DATE,
  kind: s.kind,
  scientificName: s.sci,
  commonNames: s.names,
  source: 'builtin',
  difficulty: s.difficulty,
  temp: r(s.temp),
  ph: r(s.ph),
  gh: r(s.gh),
  kh: r(s.kh),
  fauna: s.fauna,
  flora: s.flora,
  notes: s.notes,
}));
