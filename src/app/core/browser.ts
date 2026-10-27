/**
 * `navigator` tel qu'il peut être en pratique : partage, presse-papiers et vibration manquent sur bien des
 * navigateurs, alors que les types les déclarent toujours présents.
 */
export const browserNav = (): Partial<Navigator> => navigator;
