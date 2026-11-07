import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suscribir, procesarHook } from '../server/services/eventos.service.js';

// Res falso: guarda lo escrito y permite simular el cierre de la conexión.
function resFalso() {
  const res = { cabeceras: null, escrito: [], cierres: [] };
  res.writeHead = (codigo, cab) => (res.cabeceras = { codigo, cab });
  res.write = (txt) => res.escrito.push(txt);
  res.end = (txt) => (res.cuerpo = txt);
  res.on = (nombre, fn) => nombre === 'close' && res.cierres.push(fn);
  res.eventos = () =>
    res.escrito.filter((t) => t.startsWith('event: evento')).map((t) => JSON.parse(t.split('data: ')[1].trim()));
  res.cerrar = () => res.cierres.forEach((fn) => fn());
  return res;
}

// Suscribe, ejecuta los hooks y devuelve los eventos de esa sesión.
async function correr(sesion, hooks) {
  const res = resFalso();
  suscribir(res);
  try {
    for (const h of hooks) await procesarHook({ session_id: sesion, ...h });
    return res.eventos().filter((e) => e.sesion === sesion);
  } finally {
    res.cerrar();
  }
}

test('suscribir responde con SSE y saluda', () => {
  // Preparar
  const res = resFalso();
  // Actuar
  suscribir(res);
  res.cerrar();
  // Comprobar
  assert.equal(res.cabeceras.codigo, 200);
  assert.match(res.cabeceras.cab['Content-Type'], /text\/event-stream/);
  assert.equal(res.escrito[0], 'event: hola\ndata: {}\n\n');
});

test('PreToolUse con Agent emite tarea', async () => {
  // Preparar
  const hook = {
    hook_event_name: 'PreToolUse',
    tool_name: 'Agent',
    tool_input: { subagent_type: 'back', description: 'Crear ruta' },
  };
  // Actuar
  const eventos = await correr('s-tarea', [hook]);
  // Comprobar
  assert.deepEqual(eventos, [{ tipo: 'tarea', sesion: 's-tarea', agente: 'back', texto: 'Crear ruta' }]);
});

test('herramienta normal se atribuye al último subagente activo y si no, a null', async () => {
  // Preparar
  const lanzar = (tipo) => ({
    hook_event_name: 'PreToolUse',
    tool_name: 'Task',
    tool_input: { subagent_type: tipo },
  });
  const leer = { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'C:\\a\\b\\x.js' } };
  // Actuar
  const eventos = await correr('s-herr', [leer, lanzar('back'), lanzar('qa'), leer]);
  // Comprobar
  const herr = eventos.filter((e) => e.tipo === 'herramienta');
  assert.equal(herr[0].agente, null);
  assert.equal(herr[1].agente, 'qa');
  assert.equal(herr[1].herramienta, 'Read');
  assert.equal(herr[1].detalle, 'x.js');
});

test('agent_type del hook tiene prioridad sobre el subagente activo', async () => {
  // Preparar
  const hooks = [
    { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'back' } },
    { hook_event_name: 'PreToolUse', tool_name: 'Bash', agent_type: 'front', tool_input: { command: 'ls' } },
  ];
  // Actuar
  const eventos = await correr('s-tipo', hooks);
  // Comprobar
  assert.equal(eventos.at(-1).agente, 'front');
});

test('PostToolUse de Agent emite tarea_fin y libera al subagente', async () => {
  // Preparar
  const tarea = { tool_name: 'Agent', tool_input: { subagent_type: 'back' }, tool_use_id: 't1' };
  const hooks = [
    { hook_event_name: 'PreToolUse', ...tarea },
    { hook_event_name: 'PostToolUse', ...tarea },
    { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} },
  ];
  // Actuar
  const eventos = await correr('s-fin-tarea', hooks);
  // Comprobar
  assert.deepEqual(
    eventos.map((e) => e.tipo),
    ['tarea', 'tarea_fin', 'herramienta'],
  );
  assert.equal(eventos[1].agente, 'back');
  assert.equal(eventos[2].agente, null);
});

test('PostToolUse busca por tool_use_id: dos lanzamientos del mismo subagent_type', async () => {
  // Preparar
  const tarea = (id) => ({ tool_name: 'Agent', tool_input: { subagent_type: 'back' }, tool_use_id: id });
  const hooks = [
    { hook_event_name: 'PreToolUse', ...tarea('t1') },
    { hook_event_name: 'PreToolUse', ...tarea('t2') },
    { hook_event_name: 'PostToolUse', ...tarea('t1') },
    { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} },
    { hook_event_name: 'PostToolUse', ...tarea('t2') },
    { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} },
  ];
  // Actuar
  const eventos = await correr('s-mismo-tipo', hooks);
  // Comprobar
  const herr = eventos.filter((e) => e.tipo === 'herramienta');
  assert.equal(eventos.filter((e) => e.tipo === 'tarea_fin').length, 2);
  assert.equal(herr[0].agente, 'back'); // t2 sigue activo
  assert.equal(herr[1].agente, null); // ya no queda ninguno
});

test('SessionEnd borra la sesión: la herramienta posterior se atribuye a null', async () => {
  // Preparar
  const hooks = [
    { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'qa' }, tool_use_id: 'x' },
    { hook_event_name: 'SessionEnd' },
    { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} },
  ];
  // Actuar
  const eventos = await correr('s-end', hooks);
  // Comprobar
  assert.deepEqual(
    eventos.map((e) => e.tipo),
    ['tarea', 'herramienta'],
  );
  assert.equal(eventos[1].agente, null);
});

test('el cliente SSE número 21 recibe 503', () => {
  // Preparar
  const clientes = Array.from({ length: 20 }, resFalso);
  const extra = resFalso();
  try {
    // Actuar
    clientes.forEach((r) => suscribir(r));
    suscribir(extra);
    // Comprobar
    assert.ok(clientes.every((r) => r.cabeceras.codigo === 200));
    assert.equal(extra.cabeceras.codigo, 503);
  } finally {
    clientes.forEach((r) => r.cerrar());
  }
});

test('Stop emite fin (sin tokens si el transcript no existe)', async () => {
  // Preparar
  const hook = { hook_event_name: 'Stop', transcript_path: '/no/existe.jsonl' };
  // Actuar
  const eventos = await correr('s-stop', [hook]);
  // Comprobar
  assert.deepEqual(eventos, [{ tipo: 'fin', sesion: 's-stop' }]);
});

test('hook desconocido o sin tipo no emite nada', async () => {
  // Preparar
  const hooks = [{ hook_event_name: 'Otro' }, {}];
  // Actuar
  const eventos = await correr('s-nada', hooks);
  // Comprobar
  assert.deepEqual(eventos, []);
});
