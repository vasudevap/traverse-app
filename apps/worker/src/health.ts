import { createServer, type Server } from 'node:http';

export function startWorkerHealthServer(port: number, service: string): Server {
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', service }));
      return;
    }

    response.writeHead(404);
    response.end();
  });

  server.listen(port, '127.0.0.1');
  return server;
}
