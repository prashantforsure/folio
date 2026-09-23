import { createServer } from 'node:http'
import type { Server } from 'node:http'

import type { WorkerStatus } from './runtime'

/**
 * `GET /health` - roadmap task 4.1. A container host restarts a worker that
 * stops answering, and stops sending it traffic... which a worker has none of;
 * what matters is the restart. So the answer is about the two things that make
 * a worker useless while it still runs: it is shutting down, or it cannot reach
 * the database it claims from.
 *
 *   200  running, and the last claim pass or heartbeat reached the database
 *   503  starting, draining, stopped, or the database did not answer
 *
 * The body is the status as JSON either way, for a person reading it. Anything
 * but `GET /health` is a 404. `node:http`, no framework - one route does not
 * need one, and AGENTS.md puts every dependency behind a question.
 */
export const healthResponse = (status: WorkerStatus): { readonly code: 200 | 503; readonly body: string } => ({
  code: status.state === 'running' && status.databaseOk ? 200 : 503,
  body: JSON.stringify(status),
})

export const startHealthServer = (port: number, status: () => WorkerStatus): Promise<Server> =>
  new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      if (request.method !== 'GET' || request.url !== '/health') {
        response.writeHead(404, { 'content-type': 'application/json' })
        response.end('{"error":"not found"}')
        return
      }
      const { code, body } = healthResponse(status())
      response.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(body)
    })
    server.once('error', reject)
    server.listen(port, () => {
      server.off('error', reject)
      resolve(server)
    })
  })
