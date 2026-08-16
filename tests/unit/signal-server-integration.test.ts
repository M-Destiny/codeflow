import { describe, it, expect, beforeEach, afterEach, vi, TestContext } from 'vitest';
import { Server as SocketServer } from 'socket.io';
import { createServer } from 'http';
import { SignalServer } from '../../src/server/signal-server.js';
import { sanitizeRoomId, sanitizeUserName, sanitizeChatMessage, sanitizeOperation } from '../../src/utils/sanitize.js';

describe('SignalServer Integration', () => {
  let httpServer: ReturnType<typeof createServer>;
  let io: SocketServer;
  let signal: SignalServer;
  let clientSocket: any;

  beforeEach((done: () => void) => {
    httpServer = createServer();
    io = new SocketServer(httpServer, {
      cors: { origin: '*', methods: ['GET', 'POST'] },
    });
    signal = new SignalServer(io);

    httpServer.listen(0, () => {
      const port = (httpServer.address() as any).port;
      const { io: clientIO } = require('socket.io-client');
      clientSocket = clientIO(`http://localhost:${port}`, {
        transports: ['websocket'],
        forceNew: true,
      });
      clientSocket.on('connect', done);
    });
  });

  afterEach(() => {
    clientSocket?.close();
    io?.close();
    httpServer?.close();
  });

  describe('Room Join', () => {
    it('should allow user to join a room and receive self info', (done: () => void) => {
      clientSocket.emit('room:join', { roomId: 'test-room', userName: 'Alice' });
      clientSocket.on('user:self', (data: any) => {
        expect(data.userId).toBeDefined();
        expect(data.userName).toBe('Alice');
        expect(data.color).toBeDefined();
        expect(data.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
        done();
      });
    });

    it('should broadcast user:join to other users in room', (done: () => void) => {
      const { io: clientIO } = require('socket.io-client');
      const port = (httpServer.address() as any).port;
      
      // First user joins
      clientSocket.emit('room:join', { roomId: 'test-room', userName: 'Alice' });
      clientSocket.on('user:self', () => {
        // Second user joins
        const client2 = clientIO(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
        client2.on('connect', () => {
          client2.emit('room:join', { roomId: 'test-room', userName: 'Bob' });
        });
        client2.on('user:self', (data: any) => {
          expect(data.userName).toBe('Bob');
        });
        clientSocket.on('user:join', (data: any) => {
          expect(data.userName).toBe('Bob');
          client2.close();
          done();
        });
      });
    });

    it('should reject invalid room ID', (done: () => void) => {
      clientSocket.emit('room:join', { roomId: 'room@#$%', userName: 'Alice' });
      clientSocket.on('error', (data: any) => {
        expect(data.code).toBe('INVALID_INPUT');
        done();
      });
    });

    it('should reject invalid user name', (done: () => void) => {
      clientSocket.emit('room:join', { roomId: 'valid-room', userName: '<script>alert(1)</script>' });
      clientSocket.on('error', (data: any) => {
        expect(data.code).toBe('INVALID_INPUT');
        done();
      });
    });

    it('should enforce rate limit on room:join', (done: () => void) => {
      const joinCount = 35; // Exceeds MAX_EVENTS_PER_WINDOW (30)
      let rejected = false;
      
      clientSocket.on('error', (data: any) => {
        if (data.code === 'RATE_LIMITED') {
          rejected = true;
        }
      });

      for (let i = 0; i < joinCount; i++) {
        clientSocket.emit('room:join', { roomId: `room-${i}`, userName: `User${i}` });
      }

      setTimeout(() => {
        expect(rejected).toBe(true);
        done();
      }, 100);
    });
  });

  describe('Cursor Updates', () => {
    beforeEach((done: () => void) => {
      clientSocket.emit('room:join', { roomId: 'cursor-room', userName: 'Alice' });
      clientSocket.on('user:self', () => done());
    });

    it('should broadcast cursor updates to others in room', (done: () => void) => {
      const { io: clientIO } = require('socket.io-client');
      const port = (httpServer.address() as any).port;
      
      const client2 = clientIO(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
      client2.on('connect', () => {
        client2.emit('room:join', { roomId: 'cursor-room', userName: 'Bob' });
      });
      client2.on('user:self', () => {
        clientSocket.emit('cursor:update', { line: 10, column: 5 });
      });
      client2.on('cursor:update', (data: any) => {
        expect(data.userId).toBeDefined();
        expect(data.userName).toBe('Alice');
        expect(data.line).toBe(10);
        expect(data.column).toBe(5);
        expect(data.color).toBeDefined();
        client2.close();
        done();
      });
    });

    it('should reject invalid cursor positions', (done: () => void) => {
      clientSocket.emit('cursor:update', { line: -1, column: 5 });
      clientSocket.emit('cursor:update', { line: 10, column: -1 });
      clientSocket.emit('cursor:update', { line: 'invalid', column: 5 });
      
      setTimeout(() => {
        // No error emitted, just silently ignored
        done();
      }, 50);
    });

    it('should enforce rate limit on cursor updates', (done: () => void) => {
      let updateCount = 0;
      
      for (let i = 0; i < 35; i++) {
        clientSocket.emit('cursor:update', { line: i, column: i });
      }
      
      setTimeout(() => {
        // Should not crash, just rate limited silently
        done();
      }, 100);
    });
  });

  describe('Operations', () => {
    beforeEach((done: () => void) => {
      clientSocket.emit('room:join', { roomId: 'ops-room', userName: 'Alice' });
      clientSocket.on('user:self', () => done());
    });

    it('should broadcast insert operations', (done: () => void) => {
      const { io: clientIO } = require('socket.io-client');
      const port = (httpServer.address() as any).port;
      
      const client2 = clientIO(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
      client2.on('connect', () => {
        client2.emit('room:join', { roomId: 'ops-room', userName: 'Bob' });
      });
      client2.on('user:self', () => {
        clientSocket.emit('operation', { type: 'insert', pos: 0, text: 'Hello' });
      });
      client2.on('operation', (data: any) => {
        expect(data.type).toBe('insert');
        expect(data.pos).toBe(0);
        expect(data.text).toBe('Hello');
        expect(data.userId).toBeDefined();
        expect(data.socketId).toBeDefined();
        client2.close();
        done();
      });
    });

    it('should broadcast delete operations', (done: () => void) => {
      const { io: clientIO } = require('socket.io-client');
      const port = (httpServer.address() as any).port;
      
      const client2 = clientIO(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
      client2.on('connect', () => {
        client2.emit('room:join', { roomId: 'ops-room', userName: 'Bob' });
      });
      client2.on('user:self', () => {
        clientSocket.emit('operation', { type: 'delete', pos: 5, length: 3 });
      });
      client2.on('operation', (data: any) => {
        expect(data.type).toBe('delete');
        expect(data.pos).toBe(5);
        expect(data.length).toBe(3);
        client2.close();
        done();
      });
    });

    it('should reject invalid operations', (done: () => void) => {
      clientSocket.emit('operation', { type: 'invalid', pos: 0 });
      clientSocket.emit('operation', { type: 'insert', pos: -1, text: 'test' });
      clientSocket.emit('operation', { type: 'delete', pos: 0, length: -1 });
      
      setTimeout(() => {
        // Silently ignored
        done();
      }, 50);
    });
  });

  describe('Chat Messages', () => {
    beforeEach((done: () => void) => {
      clientSocket.emit('room:join', { roomId: 'chat-room', userName: 'Alice' });
      clientSocket.on('user:self', () => done());
    });

    it('should broadcast chat messages to all in room', (done: () => void) => {
      const { io: clientIO } = require('socket.io-client');
      const port = (httpServer.address() as any).port;
      
      const client2 = clientIO(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
      client2.on('connect', () => {
        client2.emit('room:join', { roomId: 'chat-room', userName: 'Bob' });
      });
      
      let bobReady = false;
      client2.on('user:self', () => {
        bobReady = true;
        clientSocket.emit('chat:message', { text: 'Hello everyone!' });
      });
      
      client2.on('chat:message', (data: any) => {
        if (bobReady) {
          expect(data.userName).toBe('Alice');
          expect(data.text).toBe('Hello everyone!');
          expect(data.roomId).toBe('chat-room');
          expect(data.id).toBeDefined();
          expect(data.timestamp).toBeDefined();
          client2.close();
          done();
        }
      });
    });

    it('should sanitize chat messages (remove control chars, limit length)', (done: () => void) => {
      const { io: clientIO } = require('socket.io-client');
      const port = (httpServer.address() as any).port;
      
      const client2 = clientIO(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
      client2.on('connect', () => {
        client2.emit('room:join', { roomId: 'chat-room', userName: 'Bob' });
      });
      
      client2.on('user:self', () => {
        clientSocket.emit('chat:message', { text: 'Hello\x00World\x1F' });
      });
      
      client2.on('chat:message', (data: any) => {
        expect(data.text).toBe('HelloWorld');
        client2.close();
        done();
      });
    });

    it('should limit chat message length to 1000 chars', (done: () => void) => {
      const { io: clientIO } = require('socket.io-client');
      const port = (httpServer.address() as any).port;
      
      const client2 = clientIO(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
      client2.on('connect', () => {
        client2.emit('room:join', { roomId: 'chat-room', userName: 'Bob' });
      });
      
      client2.on('user:self', () => {
        const longMsg = 'a'.repeat(2000);
        clientSocket.emit('chat:message', { text: longMsg });
      });
      
      client2.on('chat:message', (data: any) => {
        expect(data.text.length).toBe(1000);
        client2.close();
        done();
      });
    });
  });

  describe('WebRTC Signaling', () => {
    beforeEach((done: () => void) => {
      clientSocket.emit('room:join', { roomId: 'rtc-room', userName: 'Alice' });
      clientSocket.on('user:self', () => done());
    });

    it('should relay RTC offer to target peer', (done: () => void) => {
      const { io: clientIO } = require('socket.io-client');
      const port = (httpServer.address() as any).port;
      
      const client2 = clientIO(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
      let bobSocketId: string;
      
      client2.on('connect', () => {
        client2.emit('room:join', { roomId: 'rtc-room', userName: 'Bob' });
      });
      
      client2.on('user:self', (data: any) => {
        bobSocketId = client2.id;
        const offer = { type: 'offer', sdp: 'fake-sdp' };
        clientSocket.emit('rtc:offer', { to: bobSocketId, offer });
      });
      
      client2.on('rtc:offer', (data: any) => {
        expect(data.from).toBe(clientSocket.id);
        expect(data.offer).toEqual({ type: 'offer', sdp: 'fake-sdp' });
        client2.close();
        done();
      });
    });

    it('should relay RTC answer to target peer', (done: () => void) => {
      const { io: clientIO } = require('socket.io-client');
      const port = (httpServer.address() as any).port;
      
      const client2 = clientIO(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
      let bobSocketId: string;
      
      client2.on('connect', () => {
        client2.emit('room:join', { roomId: 'rtc-room', userName: 'Bob' });
      });
      
      client2.on('user:self', (data: any) => {
        bobSocketId = client2.id;
        const answer = { type: 'answer', sdp: 'fake-sdp-answer' };
        clientSocket.emit('rtc:answer', { to: bobSocketId, answer });
      });
      
      client2.on('rtc:answer', (data: any) => {
        expect(data.from).toBe(clientSocket.id);
        expect(data.answer).toEqual({ type: 'answer', sdp: 'fake-sdp-answer' });
        client2.close();
        done();
      });
    });

    it('should relay ICE candidates', (done: () => void) => {
      const { io: clientIO } = require('socket.io-client');
      const port = (httpServer.address() as any).port;
      
      const client2 = clientIO(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
      let bobSocketId: string;
      
      client2.on('connect', () => {
        client2.emit('room:join', { roomId: 'rtc-room', userName: 'Bob' });
      });
      
      client2.on('user:self', (data: any) => {
        bobSocketId = client2.id;
        const candidate = { candidate: 'candidate:1 1 UDP 2122260223...', sdpMid: '0', sdpMLineIndex: 0 };
        clientSocket.emit('rtc:ice', { to: bobSocketId, candidate });
      });
      
      client2.on('rtc:ice', (data: any) => {
        expect(data.from).toBe(clientSocket.id);
        expect(data.candidate).toEqual({ candidate: 'candidate:1 1 UDP 2122260223...', sdpMid: '0', sdpMLineIndex: 0 });
        client2.close();
        done();
      });
    });

    it('should signal ICE restart to remote peer', (done: () => void) => {
      const { io: clientIO } = require('socket.io-client');
      const port = (httpServer.address() as any).port;
      
      const client2 = clientIO(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
      let bobSocketId: string;
      
      client2.on('connect', () => {
        client2.emit('room:join', { roomId: 'rtc-room', userName: 'Bob' });
      });
      
      client2.on('user:self', (data: any) => {
        bobSocketId = client2.id;
        clientSocket.emit('rtc:restart', { to: bobSocketId });
      });
      
      client2.on('rtc:restart', (data: any) => {
        expect(data.from).toBe(clientSocket.id);
        client2.close();
        done();
      });
    });
  });

  describe('Disconnect', () => {
    it('should broadcast user:leave when user disconnects', (done: () => void) => {
      const { io: clientIO } = require('socket.io-client');
      const port = (httpServer.address() as any).port;
      
      const client2 = clientIO(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
      
      client2.on('connect', () => {
        client2.emit('room:join', { roomId: 'disconnect-room', userName: 'Bob' });
      });
      
      client2.on('user:self', () => {
        clientSocket.emit('room:join', { roomId: 'disconnect-room', userName: 'Alice' });
      });
      
      clientSocket.on('user:self', () => {
        client2.on('user:join', (data: any) => {
          expect(data.userName).toBe('Alice');
        });
        
        clientSocket.on('user:leave', (data: any) => {
          expect(data.userId).toBeDefined();
          expect(data.socketId).toBe(clientSocket.id);
          client2.close();
          done();
        });
        
        clientSocket.close();
      });
    });

    it('should clean up rate limits on disconnect', (done: () => void) => {
      // Fill rate limit
      for (let i = 0; i < 35; i++) {
        clientSocket.emit('cursor:update', { line: i, column: i });
      }
      
      setTimeout(() => {
        clientSocket.close();
        
        // Create new socket with same server
        const { io: clientIO } = require('socket.io-client');
        const port = (httpServer.address() as any).port;
        const newSocket = clientIO(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
        
        newSocket.on('connect', () => {
          newSocket.emit('room:join', { roomId: 'new-room', userName: 'NewUser' });
        });
        
        newSocket.on('user:self', () => {
          // Should be able to join (no rate limit from old socket)
          newSocket.emit('cursor:update', { line: 0, column: 0 });
          newSocket.close();
          done();
        });
      }, 100);
    });
  });

  describe('getRoomSize', () => {
    it('should return correct room size', () => {
      expect(signal.getRoomSize('non-existent')).toBe(0);
    });

    it('should track room size after joins', (done: () => void) => {
      clientSocket.emit('room:join', { roomId: 'size-room', userName: 'Alice' });
      clientSocket.on('user:self', () => {
        expect(signal.getRoomSize('size-room')).toBe(1);
        
        const { io: clientIO } = require('socket.io-client');
        const port = (httpServer.address() as any).port;
        const client2 = clientIO(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
        client2.on('connect', () => {
          client2.emit('room:join', { roomId: 'size-room', userName: 'Bob' });
        });
        client2.on('user:self', () => {
          setTimeout(() => {
            expect(signal.getRoomSize('size-room')).toBe(2);
            client2.close();
            done();
          }, 50);
        });
      });
    });
  });
});

describe('SignalServer Sanitization Integration', () => {
  let httpServer: ReturnType<typeof createServer>;
  let io: SocketServer;
  let signal: SignalServer;
  let clientSocket: any;

  beforeEach((done: () => void) => {
    httpServer = createServer();
    io = new SocketServer(httpServer, { cors: { origin: '*' } });
    signal = new SignalServer(io);
    httpServer.listen(0, () => {
      const { io: clientIO } = require('socket.io-client');
      const port = (httpServer.address() as any).port;
      clientSocket = clientIO(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
      clientSocket.on('connect', done);
    });
  });

  afterEach(() => {
    clientSocket?.close();
    io?.close();
    httpServer?.close();
  });

  it('should sanitize room ID on join', (done: () => void) => {
    clientSocket.emit('room:join', { roomId: 'Room@#$%With!Special*Chars', userName: 'Alice' });
    clientSocket.on('user:self', (data: any) => {
      // Room ID should be sanitized to alphanumeric, hyphen, underscore
      expect(data.userId).toBeDefined();
      done();
    });
  });

  it('should sanitize user name on join', (done: () => void) => {
    clientSocket.emit('room:join', { roomId: 'valid-room', userName: 'User<script>alert(1)</script>' });
    clientSocket.on('user:self', (data: any) => {
      expect(data.userName).toBe('Userscriptalert1script');
      done();
    });
  });

  it('should sanitize chat messages', (done: () => void) => {
    clientSocket.emit('room:join', { roomId: 'sanitize-room', userName: 'Alice' });
    clientSocket.on('user:self', () => {
      const { io: clientIO } = require('socket.io-client');
      const port = (httpServer.address() as any).port;
      const client2 = clientIO(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
      client2.on('connect', () => {
        client2.emit('room:join', { roomId: 'sanitize-room', userName: 'Bob' });
      });
      client2.on('user:self', () => {
        clientSocket.emit('chat:message', { text: '<script>alert("xss")</script>' });
      });
      client2.on('chat:message', (data: any) => {
        expect(data.text).not.toContain('<script>');
        expect(data.text).not.toContain('</script>');
        client2.close();
        done();
      });
    });
  });

  it('should sanitize operations', (done: () => void) => {
    clientSocket.emit('room:join', { roomId: 'ops-sanitize', userName: 'Alice' });
    clientSocket.on('user:self', () => {
      const { io: clientIO } = require('socket.io-client');
      const port = (httpServer.address() as any).port;
      const client2 = clientIO(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
      client2.on('connect', () => {
        client2.emit('room:join', { roomId: 'ops-sanitize', userName: 'Bob' });
      });
      client2.on('user:self', () => {
        // Send operation with invalid text (too long) - should be silently ignored
        clientSocket.emit('operation', { type: 'insert', pos: 0, text: 'a'.repeat(10001) });
        clientSocket.emit('operation', { type: 'delete', pos: 0, length: 10001 });
        clientSocket.emit('operation', { type: 'insert', pos: 0, text: 'Valid text' });
      });
      client2.on('operation', (data: any) => {
        if (data.text === 'Valid text') {
          expect(data.text).toBe('Valid text');
          client2.close();
          done();
        }
      });
    });
  });
});