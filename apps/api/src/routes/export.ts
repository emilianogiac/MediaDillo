import type { FastifyInstance } from 'fastify'
import { exportJson, exportMoviesCsv, exportShowsCsv } from '../export/exporter.js'
import {
  writeMovieNfo,
  writeShowNfo,
  writeEpisodeNfo,
  writeBulkNfo,
} from '../nfo/writer.js'

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/export/json — full library export
  app.get('/export/json', async (_req, reply) => {
    const data = await exportJson()
    return reply
      .header('Content-Type', 'application/json')
      .header('Content-Disposition', `attachment; filename="mediadillo-export-${datestamp()}.json"`)
      .send(data)
  })

  // GET /api/export/movies.csv
  app.get('/export/movies.csv', async (_req, reply) => {
    const csv = await exportMoviesCsv()
    return reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', `attachment; filename="movies-${datestamp()}.csv"`)
      .send(csv)
  })

  // GET /api/export/shows.csv
  app.get('/export/shows.csv', async (_req, reply) => {
    const csv = await exportShowsCsv()
    return reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', `attachment; filename="shows-${datestamp()}.csv"`)
      .send(csv)
  })

  // POST /api/nfo/movies/:id — write movie.nfo for a single movie
  app.post<{ Params: { id: string } }>('/nfo/movies/:id', async (req, reply) => {
    const nfoPath = await writeMovieNfo(req.params.id)
    if (!nfoPath) return reply.code(422).send({ error: 'No file found for this movie — scan first' })
    return reply.send({ path: nfoPath })
  })

  // POST /api/nfo/shows/:id — write tvshow.nfo
  app.post<{ Params: { id: string } }>('/nfo/shows/:id', async (req, reply) => {
    const nfoPath = await writeShowNfo(req.params.id)
    if (!nfoPath) return reply.code(422).send({ error: 'No file found for this show — scan first' })
    return reply.send({ path: nfoPath })
  })

  // POST /api/nfo/episodes/:id — write episode nfo
  app.post<{ Params: { id: string } }>('/nfo/episodes/:id', async (req, reply) => {
    const nfoPath = await writeEpisodeNfo(req.params.id)
    if (!nfoPath) return reply.code(422).send({ error: 'No file found for this episode' })
    return reply.send({ path: nfoPath })
  })

  // POST /api/nfo/bulk — write NFO for all owned movies + shows
  app.post('/nfo/bulk', async (_req, reply) => {
    const result = await writeBulkNfo()
    return reply.send(result)
  })
}

function datestamp(): string {
  return new Date().toISOString().slice(0, 10)
}
