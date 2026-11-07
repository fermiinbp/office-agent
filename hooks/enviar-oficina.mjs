#!/usr/bin/env node
// Hook de Claude Code para The Agent Office.
// Lee el JSON que Claude Code pasa por stdin y lo reenvía al servidor de la oficina.
// Nunca bloquea a Claude Code: si la oficina no está abierta, sale sin hacer nada.
const URL_OFICINA = process.env.AGENT_OFFICE_URL || 'http://127.0.0.1:4321/api/evento';

// Temporizador de seguridad: pase lo que pase, el hook termina en 2 s sin bloquear a Claude Code.
setTimeout(() => process.exit(0), 2000);

let entrada = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (entrada += c));
process.stdin.on('end', async () => {
  try {
    await fetch(URL_OFICINA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: entrada || '{}',
      signal: AbortSignal.timeout(800),
    });
  } catch {
    /* la oficina está cerrada: no pasa nada */
  }
  process.exit(0);
});
