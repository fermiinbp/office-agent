// Convierte los eventos de los hooks de Claude Code en eventos de la oficina y los
// reparte a las pestañas abiertas por Server-Sent Events.
//
// Atribución de herramientas: si el hook trae `agent_type`, se usa. Si no, la
// herramienta se atribuye al último subagente lanzado que siga activo en esa
// sesión, y si no hay ninguno, al jefe (sesión principal).
import { sumarTokens } from './tokens.service.js';

const clientes = new Set();
const sesiones = new Map();
const TAREA = new Set(['Task', 'Agent']);
const MAX_CLIENTES = 20;

export function suscribir(res) {
  if (clientes.size >= MAX_CLIENTES) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'Demasiados clientes conectados' }));
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('event: hola\ndata: {}\n\n');
  clientes.add(res);
  const latido = setInterval(() => res.write(': latido\n\n'), 20000);
  res.on('close', () => {
    clearInterval(latido);
    clientes.delete(res);
  });
}

function emitir(evento) {
  const data = `event: evento\ndata: ${JSON.stringify(evento)}\n\n`;
  for (const res of clientes) res.write(data);
}

function sesion(id) {
  if (!sesiones.has(id)) sesiones.set(id, { activos: [] });
  return sesiones.get(id);
}

// Claude Code en Windows manda rutas con \, así que se separa por ambos tipos de barra.
const nombreArchivo = (ruta) => String(ruta).split(/[\\/]/).pop();

function resumen(input = {}) {
  if (input.file_path) return nombreArchivo(input.file_path);
  if (input.notebook_path) return nombreArchivo(input.notebook_path);
  if (input.command) return String(input.command).slice(0, 48);
  if (input.pattern) return String(input.pattern).slice(0, 40);
  if (input.url)
    return String(input.url)
      .replace(/^https?:\/\//, '')
      .slice(0, 40);
  if (input.query) return String(input.query).slice(0, 40);
  if (input.description) return String(input.description).slice(0, 48);
  return '';
}

export async function procesarHook(p) {
  const tipo = p.hook_event_name;
  const sid = p.session_id || 'sin-sesion';
  const s = sesion(sid);

  switch (tipo) {
    case 'SessionStart':
      emitir({ tipo: 'inicio', sesion: sid });
      break;

    case 'UserPromptSubmit':
      emitir({ tipo: 'prompt', sesion: sid, texto: String(p.prompt || '').slice(0, 200) });
      break;

    case 'PreToolUse': {
      if (TAREA.has(p.tool_name)) {
        const agente = (p.tool_input && p.tool_input.subagent_type) || 'general-purpose';
        s.activos.push({ agente, id: p.tool_use_id || null });
        emitir({ tipo: 'tarea', sesion: sid, agente, texto: (p.tool_input && p.tool_input.description) || '' });
      } else {
        const ultimo = s.activos[s.activos.length - 1];
        const agente = p.agent_type || (ultimo && ultimo.agente) || null;
        emitir({ tipo: 'herramienta', sesion: sid, agente, herramienta: p.tool_name, detalle: resumen(p.tool_input) });
      }
      break;
    }

    case 'PostToolUse':
      if (TAREA.has(p.tool_name)) {
        const agente = (p.tool_input && p.tool_input.subagent_type) || 'general-purpose';
        // Primero por tool_use_id; si no aparece, por agente empezando por el final.
        let i = p.tool_use_id ? s.activos.findIndex((a) => a.id === p.tool_use_id) : -1;
        if (i === -1) {
          for (let k = s.activos.length - 1; k >= 0; k--) {
            if (s.activos[k].agente === agente) {
              i = k;
              break;
            }
          }
        }
        if (i > -1) s.activos.splice(i, 1);
        emitir({ tipo: 'tarea_fin', sesion: sid, agente });
      }
      break;

    case 'SubagentStop': {
      const agente = p.agent_type || null;
      const tokens = await sumarTokens(p.agent_transcript_path);
      if (agente && tokens) emitir({ tipo: 'tokens_agente', sesion: sid, agente, ...tokens });
      break;
    }

    case 'Stop': {
      const tokens = await sumarTokens(p.transcript_path);
      if (tokens) emitir({ tipo: 'tokens', sesion: sid, ...tokens });
      s.activos = [];
      emitir({ tipo: 'fin', sesion: sid });
      break;
    }

    case 'SessionEnd':
      sesiones.delete(sid);
      break;

    default:
      break;
  }
}
