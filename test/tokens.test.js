import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { sumarTokens } from '../server/services/tokens.service.js';

// sumarTokens solo lee dentro de ~/.claude, así que el directorio temporal vive ahí.
const dirClaude = path.join(homedir(), '.claude', `agent-office-test-${randomBytes(6).toString('hex')}`);
let dirFuera;

before(async () => {
  await mkdir(dirClaude, { recursive: true });
  dirFuera = await mkdtemp(path.join(tmpdir(), 'tokens-'));
});

after(async () => {
  await rm(dirClaude, { recursive: true, force: true });
  await rm(dirFuera, { recursive: true, force: true });
});

test('sumarTokens cuenta una vez cada message.id e incluye cache_*', async () => {
  // Preparar
  const ruta = path.join(dirClaude, 't.jsonl');
  const usoA = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 };
  const usoB = { input_tokens: 1, output_tokens: 2 };
  const lineas = [
    { message: { id: 'a', usage: usoA } },
    { message: { id: 'a', usage: usoA } },
    { message: { id: 'b', usage: usoB } },
    { type: 'user', message: { content: 'sin usage' } },
  ].map((l) => JSON.stringify(l));
  await writeFile(ruta, [...lineas, '{línea rota', ''].join('\n'));
  // Actuar
  const total = await sumarTokens(ruta);
  // Comprobar
  assert.deepEqual(total, { entrada: 10 + 100 + 1000 + 1, salida: 7 });
});

test('sumarTokens devuelve null si la ruta no existe o no se indica', async () => {
  // Preparar
  const inexistente = path.join(dirClaude, 'no-existe-xyz', 'nada.jsonl');
  // Actuar
  const a = await sumarTokens(inexistente);
  const b = await sumarTokens(undefined);
  // Comprobar
  assert.equal(a, null);
  assert.equal(b, null);
});

test('sumarTokens devuelve null para un .jsonl fuera de ~/.claude', async () => {
  // Preparar
  const ruta = path.join(dirFuera, 'fuera.jsonl');
  await writeFile(ruta, JSON.stringify({ message: { id: 'a', usage: { input_tokens: 1, output_tokens: 1 } } }) + '\n');
  // Actuar
  const total = await sumarTokens(ruta);
  // Comprobar
  assert.equal(total, null);
});

test('sumarTokens devuelve null para un .txt dentro de ~/.claude', async () => {
  // Preparar
  const ruta = path.join(dirClaude, 'notas.txt');
  await writeFile(ruta, JSON.stringify({ message: { id: 'a', usage: { input_tokens: 1, output_tokens: 1 } } }) + '\n');
  // Actuar
  const total = await sumarTokens(ruta);
  // Comprobar
  assert.equal(total, null);
});
