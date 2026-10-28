import { describe, expect, it, vi } from 'vitest';
import {
  createBrevoMailer,
  createConsoleMailer,
  createMemoryMailer,
  magicLinkMail,
} from './mailer.js';

describe('magicLinkMail', () => {
  it('contient le lien, sa durée de validité et une consigne en cas de demande non faite', () => {
    const mail = magicLinkMail('a@exemple.fr', 'https://x.fr/connexion?token=abc');
    expect(mail.to).toBe('a@exemple.fr');
    expect(mail.text).toContain('https://x.fr/connexion?token=abc');
    expect(mail.text).toContain('15 minutes');
    expect(mail.text).toContain("Si tu n'as rien demandé");
  });
});

describe('mailers de développement', () => {
  it('le transport console écrit le message en JSON', async () => {
    const lines: string[] = [];
    const mail = { to: 'a@exemple.fr', subject: 'Sujet', text: 'Corps' };
    await createConsoleMailer((l) => lines.push(l)).send(mail);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toEqual({ mail });
  });

  it('le transport mémoire conserve les messages', async () => {
    const mailer = createMemoryMailer();
    await mailer.send({ to: 'a@exemple.fr', subject: 's', text: 't' });
    expect(mailer.sent).toHaveLength(1);
  });
});

describe('createBrevoMailer', () => {
  const mail = { to: 'alice@exemple.fr', subject: 'Sujet', text: 'Corps' };
  const from = { email: 'expediteur@exemple.fr', name: 'Mes aquariums' };

  it("envoie le message à l'API de Brevo avec la clé en en-tête", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    await createBrevoMailer({ apiKey: 'cle-secrete-0123', from, fetch: send }).send(mail);
    const [url, init] = send.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'api-key': 'cle-secrete-0123',
      'content-type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      sender: from,
      to: [{ email: 'alice@exemple.fr' }],
      subject: 'Sujet',
      textContent: 'Corps',
    });
  });

  it('échoue sans révéler la clé ni le destinataire', async () => {
    const send = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    const mailer = createBrevoMailer({ apiKey: 'cle-secrete-0123', from, fetch: send });
    // Message exact : ni la clé ni l'adresse du destinataire n'y figurent.
    await expect(mailer.send(mail)).rejects.toThrow(/^Brevo a répondu 401$/);
  });

  it('échoue quand le réseau est coupé', async () => {
    const send = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(
      createBrevoMailer({ apiKey: 'cle-secrete-0123', from, fetch: send }).send(mail),
    ).rejects.toThrow();
  });
});
