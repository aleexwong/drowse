import express, { type NextFunction, type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { extractToken, tokenMatches } from './auth.ts';
import type { Config } from './config.ts';
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from './mcp.ts';
import type { TranscriptStore } from './store/types.ts';

const JSONRPC_ERROR = (code: number, message: string) => ({
  jsonrpc: '2.0' as const,
  error: { code, message },
  id: null,
});

export function createApp(store: TranscriptStore, config: Config) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  const requireToken = (req: Request, res: Response, next: NextFunction) => {
    if (tokenMatches(extractToken(req), config.token)) return next();
    // Plain 401 with no WWW-Authenticate: this server does not speak OAuth, and
    // advertising a challenge only sends clients down a discovery path that
    // does not exist here.
    res.status(401).json(JSONRPC_ERROR(-32001, 'Unauthorized'));
  };

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, server: SERVER_NAME, version: SERVER_VERSION });
  });

  // --- MCP ------------------------------------------------------------------
  // Stateless: a fresh server and transport per request, so any instance can
  // serve any request and Cloud Run can scale to zero between mornings.
  const handleMcpPost = async (req: Request, res: Response) => {
    const server = createMcpServer(store, config);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error(JSON.stringify({ event: 'mcp.error', message: String(error) }));
      if (!res.headersSent) {
        res.status(500).json(JSONRPC_ERROR(-32603, 'Internal server error'));
      }
    }
  };

  const rejectStreamMethods = (_req: Request, res: Response) => {
    res.status(405).json(JSONRPC_ERROR(-32000, 'Method not allowed. This server is stateless.'));
  };

  app.post('/mcp', requireToken, handleMcpPost);
  app.post('/mcp/:token', requireToken, handleMcpPost);
  app.get('/mcp', requireToken, rejectStreamMethods);
  app.get('/mcp/:token', requireToken, rejectStreamMethods);
  app.delete('/mcp', requireToken, rejectStreamMethods);
  app.delete('/mcp/:token', requireToken, rejectStreamMethods);

  // --- Export ---------------------------------------------------------------
  // Reading history over HTTP is fine; reading it from an MCP tool is not.
  // Nothing here is reachable from a logging conversation (PRD §6).
  const handleExport = async (_req: Request, res: Response) => {
    try {
      const transcripts = await store.listAll();
      res
        .status(200)
        .type('application/json')
        .set('Content-Disposition', 'attachment; filename="drowse-export.json"')
        .send(JSON.stringify(buildExport(transcripts), null, 2));
    } catch (error) {
      console.error(JSON.stringify({ event: 'export.error', message: String(error) }));
      res.status(500).json({ error: 'Export failed' });
    }
  };

  app.get('/export.json', requireToken, handleExport);
  app.get('/export/:token', requireToken, handleExport);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}

export function buildExport(transcripts: { id: string }[]) {
  return {
    schema: 'drowse.transcripts.v1',
    server: SERVER_NAME,
    serverVersion: SERVER_VERSION,
    exportedAt: new Date().toISOString(),
    count: transcripts.length,
    transcripts,
  };
}
