import { Server as SocketServer, Socket } from 'socket.io';
import { v4 as uuid } from 'uuid';

const USER_COLORS = [
  '#FF6B6B','#4ECDC4','#45B7D1','#96CEB4',
  '#FFEAA7','#DDA0DD','#98D8C8','#F7DC6F',
  '#BB8FCE','#85C1E9','#F8B500','#00CED1',
];

export class SignalServer {
  private rooms = new Map<string, Set<string>>();
  private userRooms = new Map<string, { roomId: string; userId: string; color: string }>();
  private io: SocketServer;
  private colorIndex = 0;
  private events = new Map<string, any[]>();

  constructor(io: SocketServer) {
    this.io = io;
    this.setupHandlers();
  }

  private assignColor(): string {
    return USER_COLORS[this.colorIndex++ % USER_COLORS.length];
  }

  private setupHandlers() {
    this.io.on('connect', (socket: Socket) => {

      socket.on('room:join', ({ roomId, userName }: { roomId: string; userName: string }) => {
        const userId = uuid();
        const color = this.assignColor();
        socket.join(roomId);
        if (!this.rooms.has(roomId)) this.rooms.set(roomId, new Set());
        this.rooms.get(roomId)!.add(socket.id);
        this.userRooms.set(socket.id, { roomId, userId, color });

        (socket as any).userId = userId;
        (socket as any).userName = userName;
        (socket as any).color = color;
        (socket as any).roomId = roomId;

        socket.to(roomId).emit('user:join', { userId, userName, color, socketId: socket.id });
        socket.emit('user:self', { userId, userName, color });
      });

      socket.on('cursor:update', (pos: { line: number; column: number }) => {
        const info = this.userRooms.get(socket.id);
        if (!info) return;
        socket.to(info.roomId).emit('cursor:update', {
          userId: info.userId, userName: (socket as any).userName, color: info.color, ...pos,
        });
      });

      socket.on('operation', (op: any) => {
        const info = this.userRooms.get(socket.id);
        if (!info) return;
        socket.to(info.roomId).emit('operation', { ...op, userId: info.userId, socketId: socket.id });
      });

      socket.on('chat:message', ({ text }: { text: string }) => {
        const info = this.userRooms.get(socket.id);
        if (!info) return;
        this.io.to(info.roomId).emit('chat:message', {
          id: uuid(), userId: info.userId, userName: (socket as any).userName,
          text: text.slice(0, 1000), timestamp: new Date(), roomId: info.roomId,
        });
      });

      socket.on('rtc:offer', ({ to, offer }: any) => this.io.to(to).emit('rtc:offer', { from: socket.id, offer }));
      socket.on('rtc:answer', ({ to, answer }: any) => this.io.to(to).emit('rtc:answer', { from: socket.id, answer }));
      socket.on('rtc:ice', ({ to, candidate }: any) => this.io.to(to).emit('rtc:ice', { from: socket.id, candidate }));

      socket.on('disconnect', () => {
        const info = this.userRooms.get(socket.id);
        if (!info) return;
        const { roomId, userId } = info;
        socket.leave(roomId);
        this.rooms.get(roomId)?.delete(socket.id);
        this.userRooms.delete(socket.id);
        socket.to(roomId).emit('user:leave', { userId, socketId: socket.id });
      });
    });
  }

  getRoomSize(roomId: string): number {
    return this.rooms.get(roomId)?.size ?? 0;
  }
}
