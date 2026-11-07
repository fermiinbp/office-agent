// Lista los agentes de la carpeta configurada. Se lee en cada petición, así que si
// cambias un .md basta con recargar la página.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/env.js';
import { parseAgentMd } from '../utils/frontmatter.js';

export async function listarAgentes() {
  let files = [];
  try {
    files = await readdir(config.agentesDir);
  } catch {
    return [];
  }
  const mds = files.filter((f) => f.toLowerCase().endsWith('.md') && f.toLowerCase() !== 'claude.md').sort();
  const out = [];
  for (const f of mds) {
    try {
      out.push(parseAgentMd(await readFile(join(config.agentesDir, f), 'utf8'), f));
    } catch {
      /* un .md ilegible no tumba la oficina */
    }
  }
  return out;
}
