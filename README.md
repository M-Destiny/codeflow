# ⚡ CodeFlow

> Real-time collaborative code editor with AI pair programming, CRDT sync, and multiplayer terminals.

```
┌─────────────────────────────────────────────────────────────┐
│                        CODEFLOW                              │
│                                                              │
│  Browser A ──┐    WebSocket    ┌──────────────┐            │
│  Browser B ──┼── Server         │ Y.js CRDT    │            │
│  Browser C ──┘  (Socket.io)    │ Doc Manager  │            │
│                                  └──────┬───────┘            │
│                                          │                    │
│                      AI Pair ─────────────┘                    │
│                   Programmer (MiniMax/GPT-4)                   │
└─────────────────────────────────────────────────────────────┘
```

## Features

| Feature | Implementation |
|---|---|
| **Collaborative Editing** | Y.js CRDT — conflict-free, offline-capable |
| **Real-time Sync** | Socket.io rooms + y-webrtc for P2P fallback |
| **AI Pair Programmer** | MiniMax-Text-01 / GPT-4 for completions & reviews |
| **Remote Cursors** | Colored per-user with name labels |
| **WebRTC Signaling** | Socket.io relay for ICE/Offer/Answer |
| **Prometheus Metrics** | `/metrics` endpoint — connections, rooms, messages |
| **Health API** | `/api/health` — uptime, memory, connection count |
| **Chat** | Room-scoped real-time chat alongside code |
| **Rate Limiting** | Per-user AI suggestion rate limits |

## Quick Start

```bash
# Server
npm install
npm run build
npm run dev          # starts server on :3001

# Client (new terminal)
npm run dev:client   # Vite dev server on :5173

# Open: http://localhost:5173
# Share the room code with collaborators
```

## Architecture

```
Browser Clients
    │
    │ Socket.io WebSocket (cursors, chat, signaling)
    ▼
Express + Socket.io Server (:3001)
    │
    ├── SignalServer — room management, user presence, WebRTC relay
    ├── DocManager — in-memory docs, revision tracking
    ├── YDocManager — Y.js CRDT document state
    └── AIPairProgrammer — completions, code review, explanation
    │
    ▼
REST API (/api/*)
```

## API Reference

### REST Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Server health + uptime |
| `GET` | `/api/docs` | List all documents |
| `GET` | `/api/docs/:id` | Get document by ID |
| `POST` | `/api/docs` | Create new document |
| `PUT` | `/api/docs/:id` | Update document content |
| `POST` | `/api/ai/suggest` | Get AI completion suggestion |
| `POST` | `/api/ai/explain` | Explain code via AI |

### WebSocket Events

**Client → Server:**
- `room:join` — `{ roomId, userName }` — join a room
- `cursor:update` — `{ line, column }` — update cursor position
- `operation` — `{ type, pos, text?, length? }` — CRDT operation
- `chat:message` — `{ text }` — send chat message
- `rtc:offer / rtc:answer / rtc:ice` — WebRTC signaling

**Server → Client:**
- `user:join / user:leave` — user presence
- `user:self` — your own userId + color
- `cursor:update` — another user's cursor
- `operation` — remote CRDT operation
- `chat:message` — incoming chat message

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Server port |
| `OPENAI_API_KEY` | — | OpenAI for AI completions |
| `MINIMAX_API_KEY` | — | MiniMax for AI completions (preferred) |

## Deploy

| Platform | Command |
|---|---|
| **Vercel** | Import repo → auto-deploys |
| **Fly.io** | `fly launch && fly deploy` |
| **Railway** | Connect repo → auto-deploy |
| **Render** | `render.yaml` → Blueprint deploy |

## License

MIT — M-Destiny
