import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseAgentMd } from '../server/utils/frontmatter.js';

test('parseAgentMd lee el frontmatter y las reglas de agentes/analista.md', async () => {
  // Preparar
  const texto = await readFile(new URL('../agentes/analista.md', import.meta.url), 'utf8');
  // Actuar
  const agente = parseAgentMd(texto, 'analista.md');
  // Comprobar
  assert.equal(agente.name, 'analista');
  assert.deepEqual(agente.tools, ['Read', 'Grep', 'Glob']);
  assert.equal(agente.model, 'opus');
  assert.match(agente.description, /^Analiza una issue/);
  assert.ok(agente.rules.length > 0 && agente.rules.length <= 6);
});

test('parseAgentMd sin frontmatter usa el nombre de archivo y la primera línea', () => {
  // Preparar
  const texto = '# Título\nHace cosas.\n';
  // Actuar
  const agente = parseAgentMd(texto, 'raro.md');
  // Comprobar
  assert.equal(agente.name, 'raro');
  assert.equal(agente.description, 'Hace cosas.');
  assert.deepEqual(agente.tools, []);
  assert.equal(agente.model, '');
});

test('parseAgentMd admite CRLF, comillas y limita las reglas a 6', () => {
  // Preparar
  const lista = Array.from({ length: 8 }, (_, i) => `- regla número ${i}`).join('\r\n');
  const texto = `---\r\nname: "qa"\r\ndescription: 'Prueba'\r\n---\r\n${lista}\r\n`;
  // Actuar
  const agente = parseAgentMd(texto, 'qa.md');
  // Comprobar
  assert.equal(agente.name, 'qa');
  assert.equal(agente.description, 'Prueba');
  assert.equal(agente.rules.length, 6);
});
