// Configuración del servidor: lee el .env de la raíz (si existe) y los argumentos.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadDotEnv() {
  const file = resolve(ROOT, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

/* --agentes "C:\ruta\.claude\agents" tiene prioridad sobre AGENTES_DIR */
function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

export const config = {
  port: Number(process.env.PORT) || 4321,
  agentesDir: resolve(ROOT, arg('--agentes') || process.env.AGENTES_DIR || 'agentes'),
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  chatModel: process.env.CHAT_MODEL || 'claude-haiku-5-5',
  clientDir: resolve(ROOT, 'client'),
};
