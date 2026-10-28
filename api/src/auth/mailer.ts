export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Envoi d'e-mails : l'implémentation réelle (service choisi à l'étape 3c) se branche ici. */
export interface Mailer {
  send: (mail: Mail) => Promise<void>;
}

/** Écrit le message sur la sortie standard : développement et tests de bout en bout seulement. */
export function createConsoleMailer(write: (line: string) => void): Mailer {
  return {
    send: (mail) => {
      write(JSON.stringify({ mail }));
      return Promise.resolve();
    },
  };
}

export interface BrevoOptions {
  apiKey: string;
  from: { email: string; name: string };
  /** Remplaçable dans les tests. */
  fetch?: typeof fetch;
}

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

/** Envoi par l'API HTTPS de Brevo (les ports SMTP sont fermés sur l'offre gratuite de Render). */
export function createBrevoMailer({ apiKey, from, fetch: send = fetch }: BrevoOptions): Mailer {
  return {
    send: async (mail) => {
      const res = await send(BREVO_URL, {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: from,
          to: [{ email: mail.to }],
          subject: mail.subject,
          textContent: mail.text,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      // Ni la clé ni l'adresse du destinataire dans le message d'erreur : il finit dans les journaux.
      if (!res.ok) throw new Error(`Brevo a répondu ${String(res.status)}`);
    },
  };
}

/** Garde les messages en mémoire, pour les tests. */
export function createMemoryMailer(): Mailer & { sent: Mail[] } {
  const sent: Mail[] = [];
  return {
    sent,
    send: (mail) => {
      sent.push(mail);
      return Promise.resolve();
    },
  };
}

export function magicLinkMail(to: string, link: string): Mail {
  return {
    to,
    subject: 'Ton lien de connexion à Mes aquariums',
    text: [
      'Bonjour,',
      '',
      'Voici ton lien de connexion à Mes aquariums (valable 15 minutes, utilisable une seule fois) :',
      link,
      '',
      "Si tu n'as rien demandé, ignore ce message : personne ne peut se connecter sans ce lien.",
    ].join('\n'),
  };
}
