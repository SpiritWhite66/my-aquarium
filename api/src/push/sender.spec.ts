import webpush from 'web-push';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebPushSender, PushError } from './sender.js';

const vapid = { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@exemple.fr' };
const target = { endpoint: 'https://push.exemple.fr/x', keys: { p256dh: 'p', auth: 'a' } };
const payload = { title: 'T', body: 'B', tag: 'aquarium-daily' as const };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createWebPushSender', () => {
  it('signe avec les clés VAPID et envoie le contenu en JSON', async () => {
    const spy = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({} as never);
    await createWebPushSender(vapid)(target, payload);
    expect(spy).toHaveBeenCalledWith(target, JSON.stringify(payload), {
      vapidDetails: vapid,
      TTL: 43200,
      timeout: 10000,
    });
  });

  it('transmet le code HTTP du service de push en cas d’échec', async () => {
    vi.spyOn(webpush, 'sendNotification').mockRejectedValue({ statusCode: 410 });
    await expect(createWebPushSender(vapid)(target, payload)).rejects.toMatchObject({
      statusCode: 410,
    });
    vi.spyOn(webpush, 'sendNotification').mockRejectedValue(new Error('réseau'));
    const err = await createWebPushSender(vapid)(target, payload).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PushError);
    expect((err as PushError).statusCode).toBeUndefined();
  });
});
