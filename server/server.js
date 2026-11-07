// The Agent Office — servidor local.
//   GET  /api/estado    → si hay chat con Claude y de qué carpeta salen los agentes
//   GET  /api/agentes   → agentes leídos de los .md
//   GET  /api/eventos   → Server-Sent Events con lo que hacen tus agentes
//   POST /api/evento    → recibe el JSON de los hooks de Claude Code
//   POST /api/chat      → chat con un héroe (necesita ANTHROPIC_API_KEY)
//   resto               → archivos de client/
import { createServer } from 'node:http';
import { config } from './config/env.js';
import { listarAgentes } from './services/agentes.service.js';
import { procesarHook, suscribir } from './services/eventos.service.js';
import { chatDisponible, responder } from './services/chat.service.js';
import { json, leerCuerpo, servirEstatico } from './utils/http.js';

// Solo se acepta tráfico dirigido a la propia oficina (evita DNS rebinding y webs externas).
const HOSTS = new Set([`localhost:${config.port}`, `127.0.0.1:${config.port}`]);
const ORIGENES = new Set([`http://localhost:${config.port}`, `http://127.0.0.1:${config.port}`]);

const server = createServer(async (req, res) => {
  try {
    if (!HOSTS.has(req.headers.host)) return json(res, 403, { error: 'Host no permitido' });
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method === 'POST') {
      const origen = req.headers.origin;
      if (origen !== undefined && !ORIGENES.has(origen)) return json(res, 403, { error: 'Origen no permitido' });
      // Exigir application/json fuerza el preflight CORS en peticiones de otras webs.
      if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
        return json(res, 415, { error: 'Content-Type debe ser application/json' });
      }
    }
    if (req.method === 'GET' && pathname === '/api/estado') {
      return json(res, 200, { chat: chatDisponible(), agentesDir: config.agentesDir });
    }
    if (req.method === 'GET' && pathname === '/api/agentes') {
      return json(res, 200, await listarAgentes());
    }
    if (req.method === 'GET' && pathname === '/api/eventos') {
      return suscribir(res);
    }
    if (req.method === 'POST' && pathname === '/api/evento') {
      const cuerpo = await leerCuerpo(req);
      res.writeHead(204);
      res.end();
      // Sin await: sumar tokens de transcripts grandes puede superar el timeout del hook.
      procesarHook(cuerpo).catch((e) => console.error('Error procesando hook:', e));
      return;
    }
    if (req.method === 'POST' && pathname === '/api/chat') {
      if (!chatDisponible()) return json(res, 503, { error: 'Falta ANTHROPIC_API_KEY en el .env' });
      return json(res, 200, await responder(await leerCuerpo(req, 32 * 1024)));
    }
    if (req.method === 'GET') return servirEstatico(res, config.clientDir, pathname);
    return json(res, 405, { error: 'Método no permitido' });
  } catch (e) {
    if (res.headersSent) return res.end();
    const status = Number.isInteger(e.status) ? e.status : 500;
    if (status === 500) {
      console.error('Error interno:', e);
      return json(res, 500, { error: 'Error interno' });
    }
    return json(res, status, { error: e.message });
  }
});

server.listen(config.port, '127.0.0.1', () => {
  console.log(`\n  The Agent Office → http://localhost:${config.port}`);
  console.log(`  Agentes: ${config.agentesDir}`);
  console.log(
    `  Chat con Claude: ${chatDisponible() ? `sí (${config.chatModel})` : 'no (añade ANTHROPIC_API_KEY al .env)'}\n`,
  );
});
