// Chat con los héroes a través de la API de Anthropic. La clave se queda en el
// servidor; el navegador nunca la ve.
import { config } from '../config/env.js';

// Límite simple: 20 peticiones por minuto (ventana deslizante en memoria).
const LIMITE = 20;
const VENTANA_MS = 60_000;
const peticiones = [];

function comprobarLimite() {
  const ahora = Date.now();
  while (peticiones.length && ahora - peticiones[0] > VENTANA_MS) peticiones.shift();
  if (peticiones.length >= LIMITE) {
    throw Object.assign(new Error('Demasiadas peticiones, espera un momento'), { status: 429 });
  }
  peticiones.push(ahora);
}

export const chatDisponible = () => Boolean(config.apiKey);

export async function responder({ system, messages }) {
  if (!config.apiKey) throw new Error('Falta ANTHROPIC_API_KEY en el .env');
  comprobarLimite();
  const turnos = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
  while (turnos.length && turnos[0].role !== 'user') turnos.shift();
  if (!turnos.length) throw new Error('No hay mensaje que responder');

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.chatModel,
      max_tokens: 300,
      system: String(system || '').slice(0, 8000),
      messages: turnos,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || `La API respondió ${r.status}`);
  const text = (j.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('')
    .trim();
  return { text: text || '…', usage: j.usage || null };
}
