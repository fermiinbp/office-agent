import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUERTO = 4398;
const BASE = `http://127.0.0.1:${PUERTO}`;
const JSON_CT = { 'Content-Type': 'application/json' };
let hijo;

// Espera a que el servidor responda (o falla si el proceso muere / tarda demasiado).
async function esperarServidor() {
  const limite = Date.now() + 10000;
  while (Date.now() < limite) {
    if (hijo.exitCode !== null) throw new Error(`El servidor terminó con código ${hijo.exitCode}`);
    try {
      const r = await fetch(`${BASE}/api/estado`);
      if (r.ok) return;
    } catch {
      /* aún no escucha */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('El servidor no respondió a tiempo');
}

// fetch no permite cambiar Host, así que se usa node:http.
function pedirConHost(host) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PUERTO, path: '/api/estado', method: 'GET', headers: { host } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  hijo = spawn(process.execPath, ['server/server.js'], {
    cwd: RAIZ,
    env: { ...process.env, PORT: String(PUERTO), AGENTES_DIR: 'agentes' },
    stdio: 'ignore',
  });
  await esperarServidor();
});

after(() => {
  if (hijo && hijo.exitCode === null) hijo.kill();
});

test('GET /api/estado responde 200', async () => {
  // Preparar / Actuar
  const r = await fetch(`${BASE}/api/estado`);
  // Comprobar
  assert.equal(r.status, 200);
  assert.equal(typeof (await r.json()).chat, 'boolean');
});

test('Host ajeno devuelve 403 y localhost:<puerto> se acepta', async () => {
  // Preparar / Actuar
  const malo = await pedirConHost('evil.com');
  const maloPuerto = await pedirConHost('localhost:9999');
  const bueno = await pedirConHost(`localhost:${PUERTO}`);
  // Comprobar
  assert.equal(malo, 403);
  assert.equal(maloPuerto, 403);
  assert.equal(bueno, 200);
});

test('POST /api/evento válido devuelve 204', async () => {
  // Preparar
  const cuerpo = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'srv-test' });
  // Actuar
  const r = await fetch(`${BASE}/api/evento`, { method: 'POST', headers: JSON_CT, body: cuerpo });
  // Comprobar
  assert.equal(r.status, 204);
});

test('POST con Origin ajeno devuelve 403', async () => {
  // Preparar
  const headers = { ...JSON_CT, Origin: 'http://evil.com' };
  // Actuar
  const r = await fetch(`${BASE}/api/evento`, { method: 'POST', headers, body: '{}' });
  // Comprobar
  assert.equal(r.status, 403);
});

test('POST con Origin propio se acepta', async () => {
  // Preparar
  const headers = { ...JSON_CT, Origin: `http://localhost:${PUERTO}` };
  // Actuar
  const r = await fetch(`${BASE}/api/evento`, { method: 'POST', headers, body: '{}' });
  // Comprobar
  assert.equal(r.status, 204);
});

test('POST sin Content-Type application/json devuelve 415', async () => {
  // Preparar / Actuar
  const r = await fetch(`${BASE}/api/evento`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: '{}',
  });
  // Comprobar
  assert.equal(r.status, 415);
});

test('POST con JSON inválido devuelve 400', async () => {
  // Preparar / Actuar
  const r = await fetch(`${BASE}/api/evento`, { method: 'POST', headers: JSON_CT, body: '{no es json' });
  // Comprobar
  assert.equal(r.status, 400);
});

test('POST con cuerpo mayor de 256 KB devuelve 413', async () => {
  // Preparar
  const grande = JSON.stringify({ relleno: 'x'.repeat(256 * 1024 + 10) });
  // Actuar
  const r = await fetch(`${BASE}/api/evento`, { method: 'POST', headers: JSON_CT, body: grande });
  // Comprobar
  assert.equal(r.status, 413);
});

test('URL mal codificada devuelve 400', async () => {
  // Preparar / Actuar
  const r = await fetch(`${BASE}/%E0%A4%A`);
  // Comprobar
  assert.equal(r.status, 400);
});
