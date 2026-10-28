import { describe, expect, it } from 'vitest';
import { createConsoleMailer, createMemoryMailer, magicLinkMail } from './mailer.js';

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
