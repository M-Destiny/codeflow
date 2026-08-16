import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { parseArgs } from 'util';
import { SignalServer } from './server/signal-server.js';
import { DocManager } from './server/doc-manager.js';
import { AIPairProgrammer } from './ai/ai-pair-programmer.js';
import { YDocManager } from './crdt/ydoc-manager.js';
import { MetricsCollector } from './monitoring/metrics.js';

const app = express().use(cors()).use(express.json());
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  pingTimeout: 20000,
  pingInterval: 25000,
  perMessageDeflate: {
    threshold: 1024, // Compress messages larger than 1KB
  },
});

const docs = new DocManager();
const ydocs = new YDocManager();
const signal = new SignalServer(io);
const ai = new AIPairProgrammer();
const metrics = new MetricsCollector();

docs.setSocket(io);

// Health endpoint
app.get('/api/health', (_, res) => res.json({
  status: 'ok',
  uptime: process.uptime(),
  connections: io.engine.clientsCount,
  rooms: io.sockets.adapter.rooms.size,
  memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
}));

// Metrics endpoint
app.get('/metrics', (_, res) => {
  const m = metrics.getAll();
  const lines = [
    `# HELP codeflow_connections_total Total connections`,
    `# TYPE codeflow_connections_total counter`,
    `codeflow_connections_total ${m.counters.connections_total ?? 0}`,
    `# HELP codeflow_active_connections Active connections`,
    `# TYPE codeflow_active_connections gauge`,
    `codeflow_active_connections ${m.gauges.connections_active ?? 0}`,
    `# HELP codeflow_rooms_total Total room joins`,
    `# TYPE codeflow_rooms_total counter`,
    `codeflow_rooms_total ${m.counters.room_joins_total ?? 0}`,
  ];
  res.type('text/plain').send(lines.join('\n'));
});

// REST docs API
app.get('/api/docs', (_, res) => res.json(docs.listDocs().map(d => ({ id: d.id, name: d.name, revision: d.revision, updatedAt: d.updatedAt }))));
app.get('/api/docs/:id', (req, res) => {
  const doc = docs.getDoc(req.params.id);
  doc ? res.json(doc) : res.status(404).json({ error: 'not found' });
});
app.post('/api/docs', (req, res) => {
  const doc = docs.createDoc(req.body.name ?? 'untitled', req.body.ownerId ?? 'anon');
  res.status(201).json(doc);
});
app.put('/api/docs/:id', (req, res) => {
  const doc = docs.updateDoc(req.params.id, req.body.content ?? '', req.body.userId ?? 'anon');
  doc ? res.json(doc) : res.status(404).json({ error: 'not found' });
});

// AI suggestions
app.post('/api/ai/suggest', async (req, res) => {
  try {
    const result = await ai.suggestCompletion(req.body.code ?? '', req.body.cursorPos ?? { line: 0, column: 0 }, req.body.userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/ai/explain', async (req, res) => {
  try {
    const result = await ai.explainCode(req.body.code ?? '');
    res.json({ explanation: result });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Socket.io ready
io.on('connect', (socket) => {
  metrics.increment('connections_total');
  metrics.gauge('connections_active', io.engine.clientsCount);
  socket.on('disconnect', () => {
    metrics.decrement('connections_active');
  });
});

const PORT = parseInt(process.env.PORT ?? '3001');
httpServer.listen(PORT, () => {
  console.log(`CodeFlow server running on :${PORT}`);
  console.log(`  REST:  http://localhost:${PORT}/api/`);
  console.log(`  WS:    ws://localhost:${PORT}/socket.io/`);
  console.log(`  Health: http://localhost:${PORT}/api/health`);
});
