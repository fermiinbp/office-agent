# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"The Agent Office": a 3D office (Three.js) where Claude Code subagents are shown as heroes working at desks. It runs in two modes: **simulation** (sample issues flow through a pipeline, with a day/night schedule) and **live** (Claude Code hooks forward real events to the local server, which pushes them to the browser over SSE). Code, comments, identifiers, UI text and docs are all in Spanish; keep that convention.

## Commands

- `npm start`: run the server at `http://localhost:4321` (no `npm install` needed; the server has zero runtime dependencies).
- `npm run dev`: same, with `node --watch` restarting on server file changes.
- `node server/server.js --agentes "<path>\.claude\agents"`: read agents from another folder (overrides `AGENTES_DIR`).
- `npm run format` / `npm run lint`: Prettier write / check (needs `npm install` once for the Prettier devDependency). Style: single quotes, printWidth 120, trailing commas, 2 spaces, LF.

There is no test suite and no build step.

Debugging in the browser console: `window.agentOffice` (e.g. `agentOffice.hour = 23`, `agentOffice.onLiveEvent({ tipo: 'tarea', agente: 'qa', texto: 'Probar' })`).

## Architecture

**Data flow in live mode:** Claude Code hook → `hooks/enviar-oficina.mjs` (forwards the hook's stdin JSON as-is to `POST /api/evento`, 800 ms timeout, always exits 0 so it never blocks Claude Code) → `server/services/eventos.service.js` translates hook events into office events (`inicio`, `prompt`, `tarea`, `herramienta`, `tarea_fin`, `tokens`, `tokens_agente`, `fin`) → broadcast via SSE on `GET /api/eventos` → `client/js/oficina.js` section 6 handles them in a `switch` on `tipo`. All hook-to-office translation logic belongs in the server, not the hook script, so it can change without touching users' Claude Code settings.

- Tool attribution: uses `agent_type` from the hook if present; otherwise the last still-active `Task`/`Agent` launch in that session (a per-session stack in `sesiones`); otherwise the boss (main session).
- Tokens: hooks don't carry usage, so `tokens.service.js` reads the transcript `.jsonl` on `Stop`/`SubagentStop` and sums `message.usage`, deduplicated by `message.id` (input includes cache reads/creation).

**Server (`server/`):** plain `node:http`, ES modules, route → service structure. `server.js` holds all routes; `config/env.js` loads `.env` manually (no dotenv) plus CLI args; `services/chat.service.js` proxies `POST /api/chat` to the Anthropic Messages API with `fetch` so `ANTHROPIC_API_KEY` never reaches the browser (model from `CHAT_MODEL`). Agents are re-read from disk on every `/api/agentes` request. Binds to `127.0.0.1` only.

**Client (`client/`):** no bundler, no modules. `index.html` loads classic scripts in order: `vendor/three.min.js` (Three.js 0.147, the last UMD build — don't upgrade to an ESM-only version), `vendor/OrbitControls.js`, `js/config.js` (sets `window.OFFICE_CONFIG`), `js/oficina.js`. This is deliberate so `index.html` also works opened via double-click with no server (then agents are loaded with a folder picker; no live mode or chat).

- `js/config.js` is the user-customizable file: `jefe` (orchestrator), `heroes` keyed by the agent's frontmatter `name`, `pipeline` order, sample `issues`, `maxAgentes` (9 = 3 rows of 3 desks). Unknown agents get an auto-generated hero; if `pipeline` is absent it is inferred from agent descriptions ("primero", "al final", "Implementa…").
- `js/oficina.js` is one large IIFE with numbered sections listed in its header comment (loading, scene + A* navigation grid, 3D heroes, schedule/routes, simulation, live mode, day/night + kanban, chat, panel/main loop). Team loading priority: server `/api/agentes` → user-loaded `.md` files → `agentesPorDefecto` in config.
- Some simulation behavior is keyed to specific agent names (`analista`, `back`, `front`, `qa`, `seguridad`, `revisor`) in `onArrive`.

**Frontmatter parsing is duplicated**: `server/utils/frontmatter.js` and `parseAgentMd` in `client/js/oficina.js` (needed for the serverless mode). Keep both in sync when changing it.

**`agentes/`** contains copies of the user's real subagent definitions (analista → back/front → qa → seguridad → revisor pipeline for a separate Express API + web project). They are data for the office, not instructions for working on this repo.

Architecture decisions and their reasons are logged in `docs/decisiones.md` (date | decision | reason); add a row there for new ones.
