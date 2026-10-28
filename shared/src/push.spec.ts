import { describe, expect, it } from 'vitest';
import { pushEndpointSchema, pushSubscriptionSchema } from './push.js';

const valid = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  keys: { p256dh: 'p', auth: 'a' },
  time: '09:00',
  timeZone: 'Europe/Paris',
  tasks: true,
  followUps: false,
};

describe('pushSubscriptionSchema', () => {
  it('accepte un abonnement complet', () => {
    expect(pushSubscriptionSchema.safeParse(valid).success).toBe(true);
    expect(pushSubscriptionSchema.safeParse({ ...valid, time: '23:59' }).success).toBe(true);
  });

  it.each([
    ['http', { ...valid, endpoint: 'http://x.fr/a' }],
    ['heure 24:00', { ...valid, time: '24:00' }],
    ['heure 9:00', { ...valid, time: '9:00' }],
    ['fuseau inconnu', { ...valid, timeZone: 'Nulle/Part' }],
    ['clé vide', { ...valid, keys: { p256dh: '', auth: 'a' } }],
  ])('refuse %s', (_nom, value) => {
    expect(pushSubscriptionSchema.safeParse(value).success).toBe(false);
  });

  it('identifie un abonnement par son adresse', () => {
    expect(pushEndpointSchema.safeParse({ endpoint: valid.endpoint }).success).toBe(true);
    expect(pushEndpointSchema.safeParse({}).success).toBe(false);
  });
});
