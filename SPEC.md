# CodeFlow — Specification

> **Spec Kit: graphify + ponytail development approach**

## 1. Concept & Vision

CodeFlow is a real-time multiplayer code editor with AI pair programming built in. Multiple users edit the same file simultaneously with conflict-free sync via Y.js CRDT, see each other's cursors in real-time, and can invoke an AI assistant for completions, code review, and explanations — all without leaving the editor.

The experience should feel like VS Code Live Share but self-hosted, more opinionated, and with a built-in AI that actually understands your codebase context.

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CODEFLOW ARCHITECTURE                     │
│                                                                  │
│  Browser A ─┐  WebRTC (y-webrtc)  ┌────────────────────────┐  │
│  Browser B ─┼─────────────────────▶│   Y.Doc (CRDT state)  │  │
│  Browser C ─┘                      └──────────┬─────────────┘  │
│                                               │                  │
│  Socket.io Relay ◀──────────── cursors, chat, signaling         │
│        │                                                           │
│        ▼                                                           │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────────────┐ │
│  │ SignalSvr   │──▶│  DocManager  │──▶│  AIPairProgrammer   │ │
│  │ (rooms,    │   │ (in-memory   │   │  (MiniMax/GPT-4     │ │
│  │  presence) │   │  docs)       │   │   completions)       │ │
│  └─────────────┘   └──────────────┘   └──────────────────────┘ │
│        │                  │                      │                │
│        ▼                  ▼                      ▼                │
│   REST API          Metrics Store           AI Rate Limits        │
│   (/api/docs)       (pino logger)          (per-user tracking)    │
└─────────────────────────────────────────────────────────────────┘
```

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20, Express 4, Socket.io 4 |
| Real-time | Y.js CRDT, y-websocket, y-webrtc |
| Frontend | React 18, Vite 5, Monaco Editor |
| AI | MiniMax-Text-01 (preferred), OpenAI GPT-4 |
| Metrics | Prometheus client (prom-client) |
| Logging | Pino with structured JSON |
| Types | TypeScript 5, Zod |

## 4. Ponytail — Task Breakdown

### Phase 1: Core Server
1. Write `src/types.ts` — all interfaces
2. Write `src/server/signal-server.ts` — Socket.io room management
3. Write `src/server/doc-manager.ts` — in-memory doc store
4. Write `src/server/index.ts` — Express + Socket.io bootstrap
5. Write `src/monitoring/metrics.ts` — Prometheus counters/gauges
6. Write `src/monitoring/event-logger.ts` — event store

### Phase 2: CRDT Layer
7. Write `src/crdt/ydoc-manager.ts` — Y.js wrapper
8. Write `src/ai/ai-pair-programmer.ts` — completions, review, explain

### Phase 3: Frontend
9. Write `vite.config.ts` — proxy config for /api + /socket.io
10. Write `src/App.tsx` — room join + main editor layout
11. Write `src/components/MonacoEditor.tsx` — collaborative editor
12. Write `src/components/UserPresence.tsx` — colored avatar pills
13. Write `src/components/AIPanel.tsx` — chat + ghost text
14. Write `src/hooks/useYjs.ts` — Y.Doc lifecycle
15. Write `src/hooks/useSocket.ts` — Socket.io client

### Phase 4: Testing & Polish
16. Write `tests/unit/ydoc-manager.test.ts`
17. Write `tests/unit/signal-server.test.ts`
18. Write `README.md` with architecture diagram
19. Write deployment configs (vercel.json, fly.toml, railway.json, render.yaml, wrangler.toml)

## 5. REST API

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | `{ uptime, memory, connections, rooms }` |
| `GET` | `/api/docs` | List all documents |
| `GET` | `/api/docs/:id` | Get single document |
| `POST` | `/api/docs` | Create document |
| `PUT` | `/api/docs/:id` | Update document |
| `POST` | `/api/ai/suggest` | `{ code, cursorPos }` → AI completion |

## 6. WebSocket Events

**Client → Server:**
- `room:join` — `{ roomId, userName }`
- `room:leave` — `{}`
- `cursor:update` — `{ line, column }`
- `operation` — `{ type: 'insert'|'delete', pos, text?, length? }`
- `chat:message` — `{ text }`
- `rtc:offer/answer/ice` — WebRTC signaling relay

**Server → Client:**
- `user:joined` — `{ id, name, color }`
- `user:left` — `{ id }`
- `user:self` — `{ id, color }` (assigned to joining user)
- `cursor:update` — `{ userId, line, column }`
- `operation` — remote CRDT operation
- `chat:message` — `{ userId, userName, text, timestamp }`

## 7. Deployment

| Platform | Config | Notes |
|---|---|---|
| Vercel | `vercel.json` | Auto-deploys on push to main |
| Fly.io | `fly.toml` | Edge globally, `fly launch` |
| Railway | `railway.json` | Connect repo → auto-deploy |
| Render | `render.yaml` | Blueprint spec |

## 8. Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Server port |
| `MINIMAX_API_KEY` | — | Preferred AI provider |
| `OPENAI_API_KEY` | — | Fallback AI provider |

## 9. Milestones

- [x] Phase 1-2: Server + CRDT (this build)
- [ ] Phase 3: Frontend with Monaco editor
- [ ] Phase 4: AI pair programmer integration
- [ ] Phase 5: WebRTC P2P fallback
- [ ] Phase 6: Full test coverage + e2e tests
