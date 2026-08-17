import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Server as SocketServer } from "socket.io";
import { createServer } from "http";
import { SignalServer } from "../../src/server/signal-server.js";

describe("Debug disconnect test", () => {
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

  it("should broadcast user:leave when user disconnects - DEBUG", async () => {
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
      client2.once("user:self", (data: any) => {
        console.log("Bob got user:self:", data);
        resolve();
      });
    });

    // Give some time for client2 to be fully in the room
    await new Promise((resolve) => setTimeout(resolve, 200));

    // ClientSocket (Alice) joins and waits for user:self
    await new Promise<void>((resolve) => {
      clientSocket.emit("room:join", {
        roomId: "disconnect-room",
        userName: "Alice",
      });
      clientSocket.once("user:self", (data: any) => {
        console.log("Alice got user:self:", data);
        resolve();
      });
    });

    // Now wait for user:join from Bob on clientSocket
    await new Promise<void>((resolve) => {
      clientSocket.once("user:join", (data: any) => {
        console.log("Alice got user:join from Bob:", data);
        expect(data.userName).toBe("Bob");
        resolve();
      });
    });

    console.log("Both users joined, now waiting for leave event on Bob's socket");

    // Now wait for user:leave when Alice disconnects
    const leavePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout waiting for user:leave")), 5000);
      client2.once("user:leave", (data: any) => {
        clearTimeout(timeout);
        console.log("Bob got user:leave:", data);
        expect(data.userId).toBeDefined();
        expect(data.socketId).toBe(clientSocket.id);
        resolve();
      });
    });

    console.log("Closing Alice's socket...");
    clientSocket.close();
    await leavePromise;
    console.log("Test passed!");
    client2.close();
  }, 15000);
});
