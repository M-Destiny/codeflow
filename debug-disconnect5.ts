import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as clientIO } from 'socket.io-client';
import { SignalServer } from './src/server/signal-server.js';

const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: '*' } });
const signal = new SignalServer(io);

httpServer.listen(0, async () => {
  const port = (httpServer.address() as any).port;
  
  const client2 = clientIO(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  await new Promise(r => client2.on('connect', r));
  
  await new Promise(r => {
    client2.emit('room:join', { roomId: 'disconnect-room', userName: 'Bob' });
    client2.once('user:self', r);
  });
  
  console.log('Client2 (Bob) joined');
  
  await new Promise((resolve) => setTimeout(resolve, 50));
  
  const client1 = clientIO(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  await new Promise(r => client1.on('connect', r));
  
  // client1 joins - this should trigger user:join on client2 (Bob)
  const joinPromiseClient2 = new Promise((resolve) => {
    client2.once("user:join", (data: any) => {
      console.log("Bob got user:join from Alice:", data);
      if (data.userName !== "Alice") throw new Error(`Expected Alice, got ${data.userName}`);
      resolve();
    });
  });
  
  await new Promise(r => {
    client1.emit('room:join', { roomId: 'disconnect-room', userName: 'Alice' });
    client1.once('user:self', r);
  });
  
  console.log('Client1 (Alice) joined');
  
  await joinPromiseClient2;
  
  console.log("Both users joined, now waiting for leave event on Bob's socket");
  
  // Now wait for user:leave when Alice disconnects
  const leavePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timeout waiting for user:leave")), 5000);
    client2.once("user:leave", (data: any) => {
      clearTimeout(timeout);
      console.log("Bob got user:leave:", data);
      if (!data.userId) throw new Error(`Expected userId to be defined`);
      // socketId should match the socket that disconnected
      console.log("client1.id =", client1.id);
      console.log("data.socketId =", data.socketId);
      resolve();
    });
  });
  
  console.log("Closing Alice's socket...");
  client1.close();
  await leavePromise;
  console.log("Test passed!");
  client2.close();
  io.close();
  httpServer.close();
});