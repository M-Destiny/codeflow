import { Server as SocketServer, Socket } from 'socket.io';
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

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export class SignalServer {
  private rooms = new Map<string, Set<string>>();
  private userRooms = new Map<string, { roomId: string; userId: string; color: string }>();
  private io: SocketServer;
  private colorIndex = 0;
  private events = new Map<string, any[]>();
  private rateLimits = new Map<string, RateLimitEntry>();

  constructor(io: SocketServer) {
    this.io = io;
    this.setupHandlers();
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
        if (typeof to === 'string' && offer) this.io.to(to).emit('rtc:offer', { from: socket.id, offer });
      });
      socket.on('rtc:answer', ({ to, answer }: any) => {
        if (!this.checkRateLimit(socket.id)) return;
        if (typeof to === 'string' && answer) this.io.to(to).emit('rtc:answer', { from: socket.id, answer });
      });
      socket.on('rtc:ice', ({ to, candidate }: any) => {
        if (!this.checkRateLimit(socket.id)) return;
        if (typeof to === 'string' && candidate) this.io.to(to).emit('rtc:ice', { from: socket.id, candidate });
      });

      socket.on('disconnect', () => {
        const info = this.userRooms.get(socket.id);
        if (!info) return;
        const { roomId, userId } = info;
        socket.leave(roomId);
        this.rooms.get(roomId)?.delete(socket.id);
        this.userRooms.delete(socket.id);
        this.rateLimits.delete(socket.id);
        socket.to(roomId).emit('user:leave', { userId, socketId: socket.id });
      });
    });
  }

  getRoomSize(roomId: string): number {
    return this.rooms.get(roomId)?.size ?? 0;
  }
}
