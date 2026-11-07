# The Agent Office

Oficina en 3D donde ves trabajar a tus subagentes de Claude Code. Cada agente es un héroe original con su mesa. El orquestador es el jefe y tiene un despacho aparte. La oficina tiene ciclo de día y noche, contador de tokens y un chat para hablar con cada héroe.

Tiene dos modos:

- **Simulación** (por defecto): el equipo se pasa issues de ejemplo siguiendo tu pipeline, hace la daily, come y duerme según la hora.
- **En directo**: si conectas el hook, la oficina muestra lo que hacen tus agentes de verdad mientras trabajas con Claude Code. Verás quién está trabajando, qué herramienta usa y en qué archivo, y los tokens reales.

## Requisitos

- Node.js 18 o superior (sin dependencias para arrancar).
- Un navegador con WebGL (Chrome, Edge, Firefox).

## Arrancar

```bash
npm start
```

Abre `http://localhost:4321`.

Por defecto lee los agentes de la carpeta `agentes/` del proyecto, que trae copiados tus 6 agentes. Para que lea los de tu proyecto directamente, tienes dos opciones:

```powershell
# opción 1: pasar la carpeta al arrancar
node server/server.js --agentes "C:\ruta\a\tu-proyecto\.claude\agents"

# opción 2: dejarla fija en el .env
copy .env.example .env
# y edita AGENTES_DIR en el .env
```

Si cambias un `.md`, basta con recargar la página.

> Sin servidor también funciona. Abre `client/index.html` con doble clic y pulsa **Cargar agentes** para elegir tu carpeta `.claude/agents`. En este modo no hay modo en directo ni chat con Claude.

## Modo en directo (hook de Claude Code)

1. Arranca la oficina (`npm start`).
2. Añade el hook a tu `.claude/settings.local.json` (o `settings.json`). Pon la ruta real donde tengas esta carpeta. Si ya tienes otros hooks en esos eventos, añade este como un elemento más del array `hooks`:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node \"C:\\ruta\\agent-office\\hooks\\enviar-oficina.mjs\"" }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node \"C:\\ruta\\agent-office\\hooks\\enviar-oficina.mjs\"" }] }
    ],
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "node \"C:\\ruta\\agent-office\\hooks\\enviar-oficina.mjs\"" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "node \"C:\\ruta\\agent-office\\hooks\\enviar-oficina.mjs\"" }]
      }
    ],
    "SubagentStop": [
      { "hooks": [{ "type": "command", "command": "node \"C:\\ruta\\agent-office\\hooks\\enviar-oficina.mjs\"" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node \"C:\\ruta\\agent-office\\hooks\\enviar-oficina.mjs\"" }] }
    ]
  }
}
```

3. Abre `http://localhost:4321`. Arriba pondrá **● Conectada · simulando**: la oficina sigue simulando hasta que usas Claude Code. Con el primer evento cambia a **● En directo**, y si pasan 10 minutos sin actividad vuelve a simular.

Qué hace cada evento en la oficina:

| Evento de Claude Code              | En la oficina                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `SessionStart`                     | El jefe abre la sesión                                                                   |
| `UserPromptSubmit`                 | El jefe recibe tu encargo                                                                |
| `PreToolUse` con `Task`/`Agent`    | El jefe lanza un avión de papel al subagente, que se sienta a trabajar                   |
| `PreToolUse` de otras herramientas | El bocadillo del agente muestra la herramienta y el archivo (`Edit · resenas.routes.js`) |
| `PostToolUse` con `Task`/`Agent`   | El subagente termina y devuelve el avión                                                 |
| `SubagentStop`                     | Tokens del subagente (si Claude Code manda su transcript)                                |
| `Stop`                             | Tokens de la sesión principal y fin del turno                                            |

El hook nunca bloquea a Claude Code: si la oficina está cerrada, sale sin hacer nada en menos de un segundo.

**Límites del modo en directo:**

- Si lanzas varios subagentes en paralelo y el hook no indica cuál usa cada herramienta, la herramienta se atribuye al último que se lanzó.
- Los tokens de entrada incluyen los leídos de caché, porque así los cuenta el transcript.

## Chat con los héroes

Copia `.env.example` como `.env` y pon tu `ANTHROPIC_API_KEY`. El servidor llama a la API de Anthropic con el modelo de `CHAT_MODEL`, y la clave nunca llega al navegador. Sin clave, los héroes responden en modo offline con frases propias.

## Personalizar

Todo lo personalizable está en `client/js/config.js`:

- `jefe`: nombre, personalidad y aspecto del orquestador.
- `heroes`: un héroe por agente. La clave es el `name` del frontmatter del `.md`. Si un agente no aparece aquí, recibe un héroe generado automáticamente.
- `pipeline`: orden en que se pasan las issues. Si lo quitas, se deduce de las descripciones (`primero`, `al final`, `Implementa…`).
- `issues`: issues de ejemplo para la simulación.

Caben hasta 9 agentes, repartidos en 3 filas de 3 mesas.

## Estructura

```
agent-office/
  agentes/              # tus agentes .md (copia; puedes apuntar a tu .claude/agents)
  client/
    index.html
    css/estilos.css
    js/config.js        # héroes, pipeline e issues (lo que tocas tú)
    js/oficina.js       # motor: escena, rutas, horario, simulación, directo y chat
    vendor/             # Three.js 0.147 + OrbitControls (licencia MIT)
  hooks/
    enviar-oficina.mjs  # hook que reenvía los eventos de Claude Code al servidor
  server/
    server.js           # rutas
    config/env.js       # lee .env y argumentos
    services/           # agentes, eventos (SSE), tokens y chat
    utils/              # frontmatter y ayudas HTTP
  docs/decisiones.md
```

## Scripts

| Script           | Qué hace                                               |
| ---------------- | ------------------------------------------------------ |
| `npm start`      | Arranca el servidor en `http://localhost:4321`         |
| `npm run dev`    | Igual, pero reinicia al cambiar archivos del servidor  |
| `npm run format` | Formatea con Prettier (necesita `npm install` una vez) |
| `npm run lint`   | Comprueba el formato                                   |

## Depurar

En la consola del navegador tienes `window.agentOffice`. Por ejemplo:

- `agentOffice.hour = 23` para ver la noche.
- `agentOffice.onLiveEvent({ tipo: 'tarea', agente: 'qa', texto: 'Probar' })` para simular un evento.
