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
