import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as clientIO } from 'socket.io-client';
import { SignalServer } from './src/server/signal-server.js';

const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: '*' } });
const signal = new SignalServer(io);

httpServer.listen(0, async () => {
  const port = httpServer.address().port;
  
  const client2 = clientIO(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  await new Promise(r => client2.on('connect', r));
  
  await new Promise(r => {
    client2.emit('room:join', { roomId: 'test', userName: 'Bob' });
    client2.once('user:self', r);
  });
  
  console.log('Client2 (Bob) joined');
  
  const client1 = clientIO(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  await new Promise(r => client1.on('connect', r));
  
  // Bob should receive user:join when Alice joins
  const joinPromise = new Promise(r => client2.once('user:join', r));
  
  await new Promise(r => {
    client1.emit('room:join', { roomId: 'test', userName: 'Alice' });
    client1.once('user:self', r);
  });
  
  console.log('Client1 (Alice) joined');
  
  // Wait for user:join on client2 (Bob receives Alice's join)
  const joinMsg = await joinPromise;
  console.log('Client2 (Bob) received user:join:', joinMsg.userName);
  
  // Now disconnect client1 (Alice) and wait for user:leave on client2 (Bob)
  console.log('Setting up leave listener on client2...');
  const leavePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for user:leave')), 10000);
    client2.once('user:leave', (data) => {
      clearTimeout(timeout);
      resolve(data);
    });
  });
  
  console.log('Closing client1 (Alice)...');
  client1.close();
  console.log('client1.close() called');
  
  const leaveMsg = await leavePromise;
  console.log('Client2 (Bob) received user:leave:', leaveMsg);
  
  client2.close();
  io.close();
  httpServer.close();
  console.log('Test passed!');
});