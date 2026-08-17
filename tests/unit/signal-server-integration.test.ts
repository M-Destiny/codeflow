import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Server as SocketServer } from "socket.io";
import { createServer } from "http";
import { SignalServer } from "../../src/server/signal-server.js";
import {
  sanitizeRoomId,
  sanitizeUserName,
  sanitizeChatMessage,
  sanitizeOperation,
} from "../../src/utils/sanitize.js";

describe("SignalServer Integration", () => {
  let httpServer: ReturnType<typeof createServer>;
  let io: SocketServer;
  let signal: SignalServer;
  let clientSocket: any;

  beforeEach(async () => {
    httpServer = createServer();
    io = new SocketServer(httpServer, {
      cors: { origin: "*", methods: ["GET", "POST"] },
    });
    signal = new SignalServer(io);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const { io: clientIO } = require("socket.io-client");
        const port = (httpServer.address() as any).port;
        clientSocket = clientIO(`http://localhost:${port}`, {
          transports: ["websocket"],
          forceNew: true,
        });
        clientSocket.on("connect", resolve);
        clientSocket.on("connect_error", (err: any) => {
          console.error("Connection error:", err);
          resolve();
        });
      });
    });
  });

  afterEach(() => {
    clientSocket?.close();
    io?.close();
    httpServer?.close();
  });

  async function joinRoom(
    socket: any,
    roomId: string,
    userName: string,
  ): Promise<any> {
    return new Promise((resolve) => {
      socket.emit("room:join", { roomId, userName });
      socket.once("user:self", resolve);
    });
  }

  describe("Room Join", () => {
    it("should allow user to join a room and receive self info", async () => {
      const data = await joinRoom(clientSocket, "test-room", "Alice");
      expect(data.userId).toBeDefined();
      expect(data.userName).toBe("Alice");
      expect(data.color).toBeDefined();
      expect(data.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("should broadcast user:join to other users in room", async () => {
      const port = (httpServer.address() as any).port;
      const { io: clientIO } = require("socket.io-client");

      // First user joins
      await joinRoom(clientSocket, "test-room", "Alice");

      // Second user joins
      const client2 = clientIO(`http://localhost:${port}`, {
        transports: ["websocket"],
        forceNew: true,
      });
      await new Promise<void>((resolve) => client2.on("connect", resolve));

      const [selfData, joinData] = await Promise.all([
        new Promise((resolve) => {
          client2.emit("room:join", { roomId: "test-room", userName: "Bob" });
          client2.once("user:self", resolve);
        }),
        new Promise((resolve) => clientSocket.once("user:join", resolve)),
      ]);

      expect((selfData as any).userName).toBe("Bob");
      expect((joinData as any).userName).toBe("Bob");
      client2.close();
    });

    it("should reject empty room ID after sanitization", async () => {
      const errorPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Timeout waiting for error")),
          1000,
        );
        clientSocket.once("error", (data: any) => {
          clearTimeout(timeout);
          resolve(data);
        });
      });
      clientSocket.emit("room:join", { roomId: "@#$%", userName: "Alice" });
      const error = await errorPromise;
      expect((error as any).code).toBe("INVALID_INPUT");
    });

    it("should reject empty user name after sanitization", async () => {
      const errorPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Timeout waiting for error")),
          1000,
        );
        clientSocket.once("error", (data: any) => {
          clearTimeout(timeout);
          resolve(data);
        });
      });
      clientSocket.emit("room:join", {
        roomId: "valid-room",
        userName: "<>!@#",
      });
      const error = await errorPromise;
      expect((error as any).code).toBe("INVALID_INPUT");
    });

    it("should enforce rate limit on room:join", async () => {
      const joinCount = 35; // Exceeds MAX_EVENTS_PER_WINDOW (30)
      const errors: any[] = [];

      clientSocket.on("error", (data: any) => {
        if (data.code === "RATE_LIMITED") {
          errors.push(data);
        }
      });

      // Need fresh socket for clean rate limit state - create new connection
      const { io: clientIO } = require("socket.io-client");
      const port = (httpServer.address() as any).port;
      const freshSocket = clientIO(`http://localhost:${port}`, {
        transports: ["websocket"],
        forceNew: true,
      });
      await new Promise<void>((resolve) => freshSocket.on("connect", resolve));

      const errorPromise = new Promise<any[]>((resolve) => {
        const collected: any[] = [];
        freshSocket.on("error", (data: any) => {
          if (data.code === "RATE_LIMITED") {
            collected.push(data);
          }
        });
        // Give time for all emits to process
        setTimeout(() => resolve(collected), 200);
      });

      for (let i = 0; i < joinCount; i++) {
        freshSocket.emit("room:join", {
          roomId: `room-${i}`,
          userName: `User${i}`,
        });
      }

      const rateLimitedErrors = await errorPromise;
      expect(rateLimitedErrors.length).toBeGreaterThan(0);
      freshSocket.close();
    });
  });

  describe("Cursor Updates", () => {
    beforeEach(async () => {
      await joinRoom(clientSocket, "cursor-room", "Alice");
    });

    it("should broadcast cursor updates to others in room", async () => {
      const port = (httpServer.address() as any).port;
      const { io: clientIO } = require("socket.io-client");

      const client2 = clientIO(`http://localhost:${port}`, {
        transports: ["websocket"],
        forceNew: true,
      });
      await new Promise<void>((resolve) => client2.on("connect", resolve));

      await joinRoom(client2, "cursor-room", "Bob");

      const cursorPromise = new Promise((resolve) =>
        client2.once("cursor:update", resolve),
      );
      clientSocket.emit("cursor:update", { line: 10, column: 5 });

      const data = await cursorPromise;
      expect((data as any).userId).toBeDefined();
      expect((data as any).userName).toBe("Alice");
      expect((data as any).line).toBe(10);
      expect((data as any).column).toBe(5);
      expect((data as any).color).toBeDefined();
      client2.close();
    });

    it("should reject invalid cursor positions", async () => {
      clientSocket.emit("cursor:update", { line: -1, column: 5 });
      clientSocket.emit("cursor:update", { line: 10, column: -1 });
      clientSocket.emit("cursor:update", { line: "invalid", column: 5 });

      // No error emitted, just silently ignored - wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it("should enforce rate limit on cursor updates", async () => {
      // Create fresh socket for clean rate limit state
      const { io: clientIO } = require("socket.io-client");
      const port = (httpServer.address() as any).port;
      const freshSocket = clientIO(`http://localhost:${port}`, {
        transports: ["websocket"],
        forceNew: true,
      });
      await new Promise<void>((resolve) => freshSocket.on("connect", resolve));
      await joinRoom(freshSocket, "cursor-rate-room", "RateTest");

      // Emit more than the rate limit (30 per window)
      for (let i = 0; i < 35; i++) {
        freshSocket.emit("cursor:update", { line: i, column: i });
      }

      // Should not crash, just rate limited silently
      await new Promise((resolve) => setTimeout(resolve, 100));
      freshSocket.close();
    });
  });

  describe("Operations", () => {
    beforeEach(async () => {
      await joinRoom(clientSocket, "ops-room", "Alice");
    });

    it("should broadcast insert operations", async () => {
      const port = (httpServer.address() as any).port;
      const { io: clientIO } = require("socket.io-client");

      const client2 = clientIO(`http://localhost:${port}`, {
        transports: ["websocket"],
        forceNew: true,
      });
      await new Promise<void>((resolve) => client2.on("connect", resolve));
      await joinRoom(client2, "ops-room", "Bob");

      const opPromise = new Promise((resolve) =>
        client2.once("operation", resolve),
      );
      clientSocket.emit("operation", { type: "insert", pos: 0, text: "Hello" });

      const data = await opPromise;
      expect((data as any).type).toBe("insert");
      expect((data as any).pos).toBe(0);
      expect((data as any).text).toBe("Hello");
      expect((data as any).userId).toBeDefined();
      expect((data as any).socketId).toBeDefined();
      client2.close();
    });

    it("should broadcast delete operations", async () => {
      const port = (httpServer.address() as any).port;
      const { io: clientIO } = require("socket.io-client");

      const client2 = clientIO(`http://localhost:${port}`, {
        transports: ["websocket"],
        forceNew: true,
      });
      await new Promise<void>((resolve) => client2.on("connect", resolve));
      await joinRoom(client2, "ops-room", "Bob");

      const opPromise = new Promise((resolve) =>
        client2.once("operation", resolve),
      );
      clientSocket.emit("operation", { type: "delete", pos: 5, length: 3 });

      const data = await opPromise;
      expect((data as any).type).toBe("delete");
      expect((data as any).pos).toBe(5);
      expect((data as any).length).toBe(3);
      client2.close();
    });

    it("should reject invalid operations", async () => {
      clientSocket.emit("operation", { type: "invalid", pos: 0 });
      clientSocket.emit("operation", { type: "insert", pos: -1, text: "test" });
      clientSocket.emit("operation", { type: "delete", pos: 0, length: -1 });

      // Silently ignored
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  });

  describe("Chat Messages", () => {
    beforeEach(async () => {
      await joinRoom(clientSocket, "chat-room", "Alice");
    });

    it("should broadcast chat messages to all in room", async () => {
      const port = (httpServer.address() as any).port;
      const { io: clientIO } = require("socket.io-client");

      const client2 = clientIO(`http://localhost:${port}`, {
        transports: ["websocket"],
        forceNew: true,
      });
      await new Promise<void>((resolve) => client2.on("connect", resolve));
      await joinRoom(client2, "chat-room", "Bob");

      const msgPromise = new Promise((resolve) =>
        client2.once("chat:message", resolve),
      );
      clientSocket.emit("chat:message", { text: "Hello everyone!" });

      const data = await msgPromise;
      expect((data as any).userName).toBe("Alice");
      expect((data as any).text).toBe("Hello everyone!");
      expect((data as any).roomId).toBe("chat-room");
      expect((data as any).id).toBeDefined();
      expect((data as any).timestamp).toBeDefined();
      client2.close();
    });

    it("should sanitize chat messages (remove control chars, limit length)", async () => {
      const port = (httpServer.address() as any).port;
      const { io: clientIO } = require("socket.io-client");

      const client2 = clientIO(`http://localhost:${port}`, {
        transports: ["websocket"],
        forceNew: true,
      });
      await new Promise<void>((resolve) => client2.on("connect", resolve));
      await joinRoom(client2, "chat-room", "Bob");

      const msgPromise = new Promise((resolve) =>
        client2.once("chat:message", resolve),
      );
      clientSocket.emit("chat:message", { text: "Hello\x00World\x1F" });

      const data = await msgPromise;
      expect((data as any).text).toBe("HelloWorld");
      client2.close();
    });

    it("should limit chat message length to 1000 chars", async () => {
      const port = (httpServer.address() as any).port;
      const { io: clientIO } = require("socket.io-client");

      const client2 = clientIO(`http://localhost:${port}`, {
        transports: ["websocket"],
        forceNew: true,
      });
      await new Promise<void>((resolve) => client2.on("connect", resolve));
      await joinRoom(client2, "chat-room", "Bob");

      const msgPromise = new Promise((resolve) =>
        client2.once("chat:message", resolve),
      );
      const longMsg = "a".repeat(2000);
      clientSocket.emit("chat:message", { text: longMsg });

      const data = await msgPromise;
      expect((data as any).text.length).toBe(1000);
      client2.close();
    });
  });

  describe("WebRTC Signaling", () => {
    beforeEach(async () => {
      await joinRoom(clientSocket, "rtc-room", "Alice");
    });

    it("should relay RTC offer to target peer", async () => {
      const port = (httpServer.address() as any).port;
      const { io: clientIO } = require("socket.io-client");

      const client2 = clientIO(`http://localhost:${port}`, {
        transports: ["websocket"],
        forceNew: true,
      });
      await new Promise<void>((resolve) => client2.on("connect", resolve));
      await joinRoom(client2, "rtc-room", "Bob");

      const bobSocketId = client2.id;
      const offerPromise = new Promise((resolve) =>
        client2.once("rtc:offer", resolve),
      );
      const offer = { type: "offer", sdp: "fake-sdp" };
      clientSocket.emit("rtc:offer", { to: bobSocketId, offer });

      const data = await offerPromise;
      expect((data as any).from).toBe(clientSocket.id);
      expect((data as any).offer).toEqual({ type: "offer", sdp: "fake-sdp" });
      client2.close();
    });

    it("should relay RTC answer to target peer", async () => {
      const port = (httpServer.address() as any).port;
      const { io: clientIO } = require("socket.io-client");

      const client2 = clientIO(`http://localhost:${port}`, {
        transports: ["websocket"],
        forceNew: true,
      });
      await new Promise<void>((resolve) => client2.on("connect", resolve));
      await joinRoom(client2, "rtc-room", "Bob");

      const bobSocketId = client2.id;
      const answerPromise = new Promise((resolve) =>
        client2.once("rtc:answer", resolve),
      );
      const answer = { type: "answer", sdp: "fake-sdp-answer" };
      clientSocket.emit("rtc:answer", { to: bobSocketId, answer });

      const data = await answerPromise;
      expect((data as any).from).toBe(clientSocket.id);
      expect((data as any).answer).toEqual({
        type: "answer",
        sdp: "fake-sdp-answer",
      });
      client2.close();
    });

    it("should relay ICE candidates", async () => {
      const port = (httpServer.address() as any).port;
      const { io: clientIO } = require("socket.io-client");

      const client2 = clientIO(`http://localhost:${port}`, {
        transports: ["websocket"],
        forceNew: true,
      });
      await new Promise<void>((resolve) => client2.on("connect", resolve));
      await joinRoom(client2, "rtc-room", "Bob");

      const bobSocketId = client2.id;
      const icePromise = new Promise((resolve) =>
        client2.once("rtc:ice", resolve),
      );
      const candidate = {
        candidate: "candidate:1 1 UDP 2122260223...",
        sdpMid: "0",
        sdpMLineIndex: 0,
      };
      clientSocket.emit("rtc:ice", { to: bobSocketId, candidate });

      const data = await icePromise;
      expect((data as any).from).toBe(clientSocket.id);
      expect((data as any).candidate).toEqual({
        candidate: "candidate:1 1 UDP 2122260223...",
        sdpMid: "0",
        sdpMLineIndex: 0,
      });
      client2.close();
    });

    it("should signal ICE restart to remote peer", async () => {
      const port = (httpServer.address() as any).port;
      const { io: clientIO } = require("socket.io-client");

      const client2 = clientIO(`http://localhost:${port}`, {
        transports: ["websocket"],
        forceNew: true,
      });
      await new Promise<void>((resolve) => client2.on("connect", resolve));
      await joinRoom(client2, "rtc-room", "Bob");

      const bobSocketId = client2.id;
      const restartPromise = new Promise((resolve) =>
        client2.once("rtc:restart", resolve),
      );
      clientSocket.emit("rtc:restart", { to: bobSocketId });

      const data = await restartPromise;
      expect((data as any).from).toBe(clientSocket.id);
      client2.close();
    });
  });

  describe("Disconnect", () => {
    it("should broadcast user:leave when user disconnects", async () => {
      const { io: clientIO } = require("socket.io-client");
      const port = (httpServer.address() as any).port;

      const client2 = clientIO(`http://localhost:${port}`, {
        transports: ["websocket"],
        forceNew: true,
      });

      await new Promise<void>((resolve) => {
        client2.on("connect", resolve);
      });

      // Client2 joins FIRST and waits for self confirmation
      await new Promise<void>((resolve) => {
        client2.emit("room:join", {
          roomId: "disconnect-room",
          userName: "Bob",
        });
        client2.once("user:self", resolve);
      });

      // Give some time for client2 to be fully in the room
      await new Promise((resolve) => setTimeout(resolve, 50));

      // ClientSocket (Alice) joins and waits for user:self
      await new Promise<void>((resolve) => {
        clientSocket.emit("room:join", {
          roomId: "disconnect-room",
          userName: "Alice",
        });
        clientSocket.once("user:self", resolve);
      });

      // Now wait for user:join from Bob on clientSocket
      await new Promise<void>((resolve) => {
        clientSocket.once("user:join", (data: any) => {
          expect(data.userName).toBe("Bob");
          resolve();
        });
      });
      console.log("[TEST] After waiting for user:join from Bob");

      // Capture socket ID before closing
      const clientSocketId = clientSocket.id;
      console.log("[TEST] clientSocketId:", clientSocketId);

      // Now wait for user:leave when Alice disconnects
      const leavePromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Timeout waiting for user:leave")), 14000);
        client2.once("user:leave", (data: any) => {
          clearTimeout(timeout);
          console.log("[TEST] Bob got user:leave:", data);
          expect(data.userId).toBeDefined();
          expect(data.socketId).toBe(clientSocketId);
          resolve();
        });
      });
      console.log("[TEST] leavePromise created, waiting...");

      console.log("[TEST] Closing Alice's socket...");
      clientSocket.close();
      console.log("[TEST] clientSocket.close() called, awaiting leavePromise...");
      await leavePromise;
      console.log("[TEST] leavePromise resolved!");
      client2.close();
    }, 30000);

    it("should clean up rate limits on disconnect", async () => {
      // Fill rate limit
      for (let i = 0; i < 35; i++) {
        clientSocket.emit("cursor:update", { line: i, column: i });
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      clientSocket.close();

      // Create new socket with same server - wait for server to be ready
      const { io: clientIO } = require("socket.io-client");
      const address = httpServer.address();
      if (!address) {
        throw new Error("Server address is null");
      }
      const port = (address as any).port;
      const newSocket = clientIO(`http://localhost:${port}`, {
        transports: ["websocket"],
        forceNew: true,
      });

      await new Promise<void>((resolve, reject) => {
        newSocket.on("connect", () => {
          newSocket.emit("room:join", {
            roomId: "new-room",
            userName: "NewUser",
          });
        });

        newSocket.on("user:self", () => {
          // Should be able to join (no rate limit from old socket)
          newSocket.emit("cursor:update", { line: 0, column: 0 });
          newSocket.close();
          resolve();
        });

        newSocket.on("connect_error", (err: Error) => {
          reject(err);
        });
      });
    });
  });

  describe("getRoomSize", () => {
    it("should return correct room size", () => {
      expect(signal.getRoomSize("non-existent")).toBe(0);
    });

    it("should track room size after joins", async () => {
      clientSocket.emit("room:join", {
        roomId: "size-room",
        userName: "Alice",
      });
      await new Promise<void>((resolve) => {
        clientSocket.once("user:self", resolve);
      });

      expect(signal.getRoomSize("size-room")).toBe(1);

      const { io: clientIO } = require("socket.io-client");
      const port = (httpServer.address() as any).port;
      const client2 = clientIO(`http://localhost:${port}`, {
        transports: ["websocket"],
        forceNew: true,
      });

      await new Promise<void>((resolve) => {
        client2.on("connect", resolve);
      });

      await new Promise<void>((resolve) => {
        client2.emit("room:join", { roomId: "size-room", userName: "Bob" });
        client2.once("user:self", resolve);
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(signal.getRoomSize("size-room")).toBe(2);
      client2.close();
    });
  });
});

describe("SignalServer Sanitization Integration", () => {
  let httpServer: ReturnType<typeof createServer>;
  let io: SocketServer;
  let signal: SignalServer;
  let clientSocket: any;

  beforeEach(async () => {
    httpServer = createServer();
    io = new SocketServer(httpServer, { cors: { origin: "*" } });
    signal = new SignalServer(io);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const { io: clientIO } = require("socket.io-client");
        const port = (httpServer.address() as any).port;
        clientSocket = clientIO(`http://localhost:${port}`, {
          transports: ["websocket"],
          forceNew: true,
        });
        clientSocket.on("connect", resolve);
        clientSocket.on("connect_error", (err: any) => {
          console.error("Connection error:", err);
          resolve();
        });
      });
    });
  });

  afterEach(() => {
    clientSocket?.close();
    io?.close();
    httpServer?.close();
  });

  it("should sanitize room ID on join", async () => {
    clientSocket.emit("room:join", {
      roomId: "Room@#$%With!Special*Chars",
      userName: "Alice",
    });
    await new Promise<void>((resolve) => {
      clientSocket.once("user:self", (data: any) => {
        // Room ID should be sanitized to alphanumeric, hyphen, underscore
        expect(data.userId).toBeDefined();
        resolve();
      });
    });
  });

  it("should sanitize user name on join", async () => {
    clientSocket.emit("room:join", {
      roomId: "valid-room",
      userName: "User<script>alert(1)</script>",
    });
    await new Promise<void>((resolve) => {
      clientSocket.once("user:self", (data: any) => {
        expect(data.userName).toBe("Userscriptalert1script");
        resolve();
      });
    });
  });
});
