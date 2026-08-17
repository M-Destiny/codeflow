import { Server as SocketServer, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { v4 as uuid } from 'uuid';
import { sanitizeRoomId, sanitizeUserName, sanitizeChatMessage, sanitizeOperation } from '../utils/sanitize.js';

const USER_COLORS = [
  '#FF6B6B','#4ECDC4','#45B7D1','#96CEB4',
  '#FFEAA7','#DDA0DD','#98D8C8','#F7DC6F',
  '#BB8FCE','#85C1E9','#F8B500','#00CED1',
];

// Rate limiting: max events per second per socket
const RATE_LIMIT_WINDOW_MS = 1000;
const MAX_EVENTS_PER_WINDOW = 30;

// WebRTC ICE configuration
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  // TURN servers can be added via environment variable
  ...(process.env.TURN_URLS ? process.env.TURN_URLS.split(',').map(url => {
    const [urls, username, credential] = url.split('|');
    return { urls, username, credential };
  }) : []),
];

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

interface PeerConnectionState {
  socketId: string;
  userId: string;
  roomId: string;
  iceConnectionState: RTCIceConnectionState;
  lastActivity: number;
  iceRestartCount: number;
  reconnectAttempts: number;
  lastReconnectAttempt: number;
}

interface RtcRestartState {
  lastRestartAt: number;
  restartCount: number;
}

export class SignalServer {
  private rooms = new Map<string, Set<string>>();
  private userRooms = new Map<string, { roomId: string; userId: string; color: string }>();
  private io: SocketServer;
  private colorIndex = 0;
  private events = new Map<string, any[]>();
  private rateLimits = new Map<string, RateLimitEntry>();
  private peerConnections = new Map<string, PeerConnectionState>(); // key: `${roomId}:${socketId}`
  private rtcRestartState = new Map<string, RtcRestartState>(); // key: `${roomId}:${socketId}:${targetSocketId}`
  private readonly MAX_ICE_RESTARTS = 3;
  private readonly ICE_RESTART_COOLDOWN_MS = 5000;
  private readonly MAX_RECONNECT_ATTEMPTS = 3;
  private readonly RECONNECT_COOLDOWN_MS = 10000;

  constructor(io: SocketServer) {
    this.io = io;
    this.setupRedisAdapter();
    this.setupHandlers();
  }

  /**
   * Initialize Redis adapter for horizontal scaling
   * Requires REDIS_URL environment variable
   */
  private async setupRedisAdapter(): Promise<void> {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) return; // Skip if not configured (single instance mode)

    try {
      const pubClient = createClient({ url: redisUrl });
      const subClient = pubClient.duplicate();
      
      await Promise.all([
        pubClient.connect(),
        subClient.connect()
      ]);

      this.io.adapter(createAdapter(pubClient, subClient));
      console.log('Redis adapter enabled for Socket.io horizontal scaling');
    } catch (err) {
      console.error('Failed to initialize Redis adapter:', err);
      // Continue without Redis adapter
    }
  }

  private assignColor(): string {
    return USER_COLORS[this.colorIndex++ % USER_COLORS.length];
  }

  private checkRateLimit(socketId: string): boolean {
    const now = Date.now();
    const entry = this.rateLimits.get(socketId);
    if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
      this.rateLimits.set(socketId, { count: 1, windowStart: now });
      return true;
    }
    if (entry.count >= MAX_EVENTS_PER_WINDOW) {
      return false;
    }
    entry.count++;
    return true;
  }

  private setupHandlers() {
    this.io.on('connect', (socket: Socket) => {

      socket.on('room:join', ({ roomId, userName }: { roomId: string; userName: string }) => {
        if (!this.checkRateLimit(socket.id)) {
          socket.emit('error', { code: 'RATE_LIMITED', message: 'Too many requests' });
          return;
        }

        const sanitizedRoomId = sanitizeRoomId(roomId);
        const sanitizedUserName = sanitizeUserName(userName);
        
        // Use sanitized values; reject only if sanitization results in empty strings
        if (!sanitizedRoomId || !sanitizedUserName) {
          socket.emit('error', { code: 'INVALID_INPUT', message: 'Invalid room ID or user name' });
          return;
        }

        const userId = uuid();
        const color = this.assignColor();
        socket.join(sanitizedRoomId);
        if (!this.rooms.has(sanitizedRoomId)) this.rooms.set(sanitizedRoomId, new Set());
        this.rooms.get(sanitizedRoomId)!.add(socket.id);
        this.userRooms.set(socket.id, { roomId: sanitizedRoomId, userId, color });

        (socket as any).userId = userId;
        (socket as any).userName = sanitizedUserName;
        (socket as any).color = color;
        (socket as any).roomId = sanitizedRoomId;

        socket.to(sanitizedRoomId).emit('user:join', { userId, userName: sanitizedUserName, color, socketId: socket.id });
        socket.emit('user:self', { userId, userName: sanitizedUserName, color });
      });

      socket.on('cursor:update', (pos: { line: number; column: number }) => {
        if (!this.checkRateLimit(socket.id)) return;
        const info = this.userRooms.get(socket.id);
        if (!info) return;
        // Validate cursor position
        if (typeof pos?.line !== 'number' || typeof pos?.column !== 'number' || pos.line < 0 || pos.column < 0) return;
        socket.to(info.roomId).emit('cursor:update', {
          userId: info.userId, userName: (socket as any).userName, color: info.color, ...pos,
        });
      });

      socket.on('operation', (op: any) => {
        if (!this.checkRateLimit(socket.id)) return;
        const info = this.userRooms.get(socket.id);
        if (!info) return;
        const sanitizedOp = sanitizeOperation(op);
        if (!sanitizedOp) return;
        socket.to(info.roomId).emit('operation', { ...sanitizedOp, userId: info.userId, socketId: socket.id });
      });

      socket.on('chat:message', ({ text }: { text: string }) => {
        if (!this.checkRateLimit(socket.id)) return;
        const info = this.userRooms.get(socket.id);
        if (!info) return;
        const sanitizedText = sanitizeChatMessage(text);
        if (!sanitizedText) return;
        this.io.to(info.roomId).emit('chat:message', {
          id: uuid(), userId: info.userId, userName: (socket as any).userName,
          text: sanitizedText, timestamp: new Date(), roomId: info.roomId,
        });
      });

      socket.on('rtc:offer', ({ to, offer }: any) => {
        if (!this.checkRateLimit(socket.id)) return;
        if (typeof to === 'string' && offer) {
          const info = this.userRooms.get(socket.id);
          if (!info) return;
          this.io.to(to).emit('rtc:offer', { from: socket.id, offer });
          
          // Initialize peer connection state
          const key = `${info.roomId}:${socket.id}:${to}`;
          if (!this.peerConnections.has(key)) {
            this.peerConnections.set(key, {
              socketId: socket.id,
              userId: info.userId,
              roomId: info.roomId,
              iceConnectionState: 'new',
              lastActivity: Date.now(),
              iceRestartCount: 0,
              reconnectAttempts: 0,
              lastReconnectAttempt: 0,
            });
          }
        }
      });
      socket.on('rtc:answer', ({ to, answer }: any) => {
        if (!this.checkRateLimit(socket.id)) return;
        if (typeof to === 'string' && answer) {
          const info = this.userRooms.get(socket.id);
          if (!info) return;
          this.io.to(to).emit('rtc:answer', { from: socket.id, answer });
          
          // Initialize peer connection state
          const key = `${info.roomId}:${socket.id}:${to}`;
          if (!this.peerConnections.has(key)) {
            this.peerConnections.set(key, {
              socketId: socket.id,
              userId: info.userId,
              roomId: info.roomId,
              iceConnectionState: 'new',
              lastActivity: Date.now(),
              iceRestartCount: 0,
              reconnectAttempts: 0,
              lastReconnectAttempt: 0,
            });
          }
        }
      });
      socket.on('rtc:ice', ({ to, candidate }: any) => {
        if (!this.checkRateLimit(socket.id)) return;
        if (typeof to === 'string' && candidate) this.io.to(to).emit('rtc:ice', { from: socket.id, candidate });
      });

      socket.on('rtc:ice-state', ({ to, state }: { to: string; state: RTCIceConnectionState }) => {
        if (!this.checkRateLimit(socket.id)) return;
        if (typeof to === 'string' && state) {
          const info = this.userRooms.get(socket.id);
          if (!info) return;
          
          this.io.to(to).emit('rtc:ice-state', { from: socket.id, state });
          
          // Track connection state for reconnection logic
          const key = `${info.roomId}:${socket.id}:${to}`;
          const peerState = this.peerConnections.get(key);
          if (peerState) {
            peerState.iceConnectionState = state;
            peerState.lastActivity = Date.now();
            
            // If connection failed or disconnected, allow reconnection attempts
            if (state === 'failed' || state === 'disconnected' || state === 'closed') {
              this.handleConnectionFailure(socket, to, info.roomId);
            }
          }
        }
      });

      socket.on('rtc:restart', ({ to }: { to: string }) => {
        if (!this.checkRateLimit(socket.id)) return;
        if (typeof to === 'string') {
          // Signal ICE restart to remote peer
          this.io.to(to).emit('rtc:restart', { from: socket.id });
        }
      });

      socket.on('disconnect', () => {
        const info = this.userRooms.get(socket.id);
        if (!info) return;
        const { roomId, userId } = info;
        socket.leave(roomId);
        this.rooms.get(roomId)?.delete(socket.id);
        this.userRooms.delete(socket.id);
        this.rateLimits.delete(socket.id);
        this.cleanupPeerConnections(socket.id);
        socket.to(roomId).emit('user:leave', { userId, socketId: socket.id });
      });
    });
  }

  private handleConnectionFailure(socket: Socket, targetSocketId: string, roomId: string) {
    const key = `${roomId}:${socket.id}:${targetSocketId}`;
    const peerState = this.peerConnections.get(key);
    if (!peerState) return;

    const now = Date.now();
    
    // Check if we've exceeded max reconnect attempts
    if (peerState.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.log(`Max reconnect attempts reached for ${key}`);
      return;
    }

    // Check cooldown
    if (now - peerState.lastReconnectAttempt < this.RECONNECT_COOLDOWN_MS) {
      return;
    }

    // Increment and schedule reconnection
    peerState.reconnectAttempts++;
    peerState.lastReconnectAttempt = now;

    // Signal the remote peer to attempt reconnection
    this.io.to(targetSocketId).emit('rtc:reconnect', { 
      from: socket.id, 
      attempt: peerState.reconnectAttempts 
    });
    
    // Also trigger ICE restart as fallback
    if (peerState.reconnectAttempts >= 2) {
      const restartKey = `${roomId}:${socket.id}:${targetSocketId}`;
      const restartState = this.rtcRestartState.get(restartKey) || { lastRestartAt: 0, restartCount: 0 };
      const timeSinceLastRestart = now - restartState.lastRestartAt;
      
      if (restartState.restartCount < this.MAX_ICE_RESTARTS && timeSinceLastRestart >= this.ICE_RESTART_COOLDOWN_MS) {
        restartState.restartCount++;
        restartState.lastRestartAt = now;
        this.rtcRestartState.set(restartKey, restartState);
        this.io.to(targetSocketId).emit('rtc:restart', { from: socket.id });
      }
    }
  }

  private cleanupPeerConnections(socketId: string) {
    // Clean up peer connection state for disconnected socket
    for (const [key, state] of this.peerConnections.entries()) {
      if (key.startsWith(`${state.roomId}:${socketId}:`) || key.endsWith(`:${socketId}`)) {
        this.peerConnections.delete(key);
      }
    }
    // Clean up restart state
    for (const key of this.rtcRestartState.keys()) {
      if (key.includes(`:${socketId}:`) || key.endsWith(`:${socketId}`)) {
        this.rtcRestartState.delete(key);
      }
    }
  }

  getRoomSize(roomId: string): number {
    return this.rooms.get(roomId)?.size ?? 0;
  }
}
