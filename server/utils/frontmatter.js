// Lee el frontmatter de un .md de subagente de Claude Code (name, description, tools, model, color)
// y saca hasta 6 reglas de las listas del cuerpo.
export function parseAgentMd(text, filename) {
  const fm = {};
  let body = text;
  const m = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (m) {
    body = text.slice(m[0].length);
    for (const line of m[1].split(/\r?\n/)) {
      const k = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
      if (k) fm[k[1].toLowerCase()] = k[2].replace(/^["']|["']$/g, '').trim();
    }
  }
  const clean = (s) =>
    s
      .replace(/<example>[\s\S]*?<\/example>/gi, '')
      .replace(/\\n/g, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const rules = [...body.matchAll(/^\s*(?:[-*]|\d+\.)\s+(.+)$/gm)]
    .map((b) => b[1].replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim())
    .filter((b) => b.length > 3)
    .slice(0, 6);
  const firstLine = body.split('\n').find((l) => l.trim() && !l.startsWith('#')) || 'Agente sin descripción.';
  return {
    name: (fm.name || filename.replace(/\.md$/i, '')).trim(),
    description: clean(fm.description || firstLine).slice(0, 300),
    tools: (fm.tools || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    model: fm.model || '',
    color: fm.color || '',
    rules,
  };
}
