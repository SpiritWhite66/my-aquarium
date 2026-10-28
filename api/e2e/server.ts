import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../dist/server.js', import.meta.url));

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (address !== null && typeof address === 'object') resolve(address.port);
        else reject(new Error('port introuvable'));
      });
    });
  });
}

async function waitReady(url: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Le serveur n'écoute pas encore : on réessaie.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Le serveur ne répond pas après 10 s');
}

export interface RunningServer {
  base: string;
  /** Sortie standard du serveur (avec `MAIL_TRANSPORT=console`, les e-mails y sont écrits en JSON). */
  output: () => string;
  stop: () => void;
}

/** Lance le serveur compilé (`npm run build -w api`) comme en production, sur un port libre. */
export async function startServer(env: Record<string, string>): Promise<RunningServer> {
  const port = await freePort();
  const base = `http://127.0.0.1:${String(port)}`;
  const child: ChildProcess = spawn(process.execPath, [entry], {
    env: {
      PATH: process.env['PATH'] ?? '',
      HOST: '127.0.0.1',
      PORT: String(port),
      LOG_LEVEL: 'silent',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  await waitReady(`${base}/health`);
  return {
    base,
    output: () => output,
    stop: () => {
      child.kill('SIGTERM');
    },
  };
}
