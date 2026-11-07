// Suma los tokens de un transcript .jsonl de Claude Code.
// Cada respuesta del modelo trae `message.usage`; un mismo mensaje puede aparecer en
// varias líneas, así que se cuenta una vez por `message.id`.
import { readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const TAM_MAX = 50 * 1024 * 1024;

// Solo se leen .jsonl que, ya resueltos los enlaces, estén dentro de ~/.claude y no pesen más de 50 MB.
async function rutaSegura(transcriptPath) {
  if (typeof transcriptPath !== 'string' || !transcriptPath) return null;
  try {
    const real = await realpath(resolve(transcriptPath));
    const base = await realpath(join(homedir(), '.claude'));
    if (!real.startsWith(base + sep) || !real.toLowerCase().endsWith('.jsonl')) return null;
    const st = await stat(real);
    if (!st.isFile() || st.size > TAM_MAX) return null;
    return real;
  } catch {
    return null;
  }
}

export async function sumarTokens(transcriptPath) {
  const ruta = await rutaSegura(transcriptPath);
  if (!ruta) return null;
  let text;
  try {
    text = await readFile(ruta, 'utf8');
  } catch {
    return null;
  }
  const porMensaje = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      const msg = j.message;
      if (msg && msg.usage) porMensaje.set(msg.id || j.uuid || porMensaje.size, msg.usage);
    } catch {
      /* línea incompleta */
    }
  }
  let entrada = 0;
  let salida = 0;
  for (const u of porMensaje.values()) {
    entrada += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    salida += u.output_tokens || 0;
  }
  return { entrada, salida };
}
