import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as clientIO } from 'socket.io-client';

const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: '*' } });

io.on('connection', (socket) => {
  console.log('Server: socket connected', socket.id);
});

httpServer.listen(0, async () => {
  const port = (httpServer.address() as any).port;
  
  const clientSocket = clientIO(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  await new Promise(r => clientSocket.on('connect', r));
  
  console.log('clientSocket.id =', clientSocket.id);
  console.log('clientSocket.connected =', clientSocket.connected);
  
  // Test close and check id
  clientSocket.close();
  console.log('After close, clientSocket.id =', clientSocket.id);
  
  io.close();
  httpServer.close();
});