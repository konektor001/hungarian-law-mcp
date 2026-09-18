#!/usr/bin/env node

/**
 * HTTP entry point for Law MCP Server (Docker proxy transport).
 *
 * Universal template — works with ANY law MCP that follows the standard
 * pattern: registerTools() in ./tools/registry.js, capabilities.js,
 * and @ansvar/mcp-sqlite database.
 *
 * Endpoints:
 *   GET  /health  → { status, server, version, uptime_seconds }
 *   POST /mcp     → MCP Streamable HTTP transport (new + existing sessions)
 *   GET  /mcp     → SSE stream (existing session) or metadata (no session)
 *   DELETE /mcp   → session termination
 *   OPTIONS *     → CORS preflight
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { existsSync, openSync, readSync, closeSync, readFileSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database from '@ansvar/mcp-sqlite';

import { registerTools } from './tools/registry.js';
import { detectCapabilities, readDbMetadata } from './capabilities.js';

// Local type — avoids import from ./tools/about.js which may not exist in all repos.
// The registerTools() `context` parameter is optional (`?`) so this is safe.
interface AboutContext {
  version: string;
  fingerprint: string;
  dbBuilt: string;
}

// ---------------------------------------------------------------------------
// Configuration (derived from package.json — works for any law MCP)
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = parseInt(process.env.PORT || '3000', 10);

function findPackageJson(): any {
  const candidates = [
    join(__dirname, '..', 'package.json'),
    join(__dirname, '..', '..', 'package.json'),
    join(process.cwd(), 'package.json'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, 'utf-8'));
      } catch { /* fallback */ }
    }
  }
  return { name: 'hungarian-law-mcp', version: '1.0.0' };
}

const pkg = findPackageJson();
const SERVER_NAME: string = pkg.name.replace(/^@ansvar\//, '');
const SERVER_VERSION: string = pkg.version;

// ---------------------------------------------------------------------------
// Database resolution (standard law MCP path convention)
// ---------------------------------------------------------------------------

function resolveDbPath(): string {
  // 1. Prefer *_LAW_DB_PATH env vars (most specific)
  for (const [key, value] of Object.entries(process.env)) {
    if (key.endsWith('_LAW_DB_PATH') && value) return value;
  }
  // 2. Fall back to any *_DB_PATH env var
  for (const [key, value] of Object.entries(process.env)) {
    if (key.endsWith('_DB_PATH') && value) return value;
  }

  // 3. Standard relative paths
  const candidates = [
    join(__dirname, '..', 'data', 'database.db'),
    join(__dirname, '..', '..', 'data', 'database.db'),
  ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  throw new Error(
    `Database not found. Set a *_DB_PATH env var or place database.db in data/`,
  );
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/** UUID v4 pattern — prevents injection via session ID header. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validSessionId(raw: string | undefined): string | undefined {
  if (!raw || !UUID_RE.test(raw)) return undefined;
  return raw;
}

const sessions = new Map<string, StreamableHTTPServerTransport>();

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const dbPath = resolveDbPath();
  const db = new Database(dbPath, { readonly: true });
  db.pragma('foreign_keys = ON');

  const caps = detectCapabilities(db);
  const meta = readDbMetadata(db);
  console.error(`[${SERVER_NAME}] Database: ${dbPath}`);
  console.error(`[${SERVER_NAME}] Tier: ${meta.tier}, Capabilities: ${[...caps].join(', ')}`);

  // About context for the about tool — use partial hash to avoid loading
  // entire DB into memory (some are 200MB+).
  let fingerprint = 'unknown';
  let dbBuilt = new Date().toISOString();
  try {
    const SAMPLE = 64 * 1024;
    const fd = openSync(dbPath, 'r');
    const buf = Buffer.alloc(SAMPLE);
    readSync(fd, buf, 0, SAMPLE, 0);
    closeSync(fd);
    fingerprint = createHash('sha256').update(buf).digest('hex').slice(0, 12);
    dbBuilt = statSync(dbPath).mtime.toISOString();
  } catch { /* non-fatal */ }

  // Try db_metadata table for built_at (newer repos have this)
  try {
    const row = db.prepare("SELECT value FROM db_metadata WHERE key = 'built_at'").get() as { value: string } | undefined;
    if (row) dbBuilt = row.value;
  } catch { /* table may not exist */ }

  const aboutContext: AboutContext = { version: SERVER_VERSION, fingerprint, dbBuilt };

  /** Create a fresh MCP server instance (one per session). */
  function createMCPServer(): Server {
    const server = new Server(
      { name: SERVER_NAME, version: SERVER_VERSION },
      { capabilities: { tools: {} } },
    );
    registerTools(server, db, aboutContext);
    return server;
  }

  // -------------------------------------------------------------------------
  // HTTP server
  // -------------------------------------------------------------------------

  const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

    try {
      // OPTIONS — preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // GET /health és GET /api/status — Szerver és Jogszabály-adatbázis állapot
      if ((url.pathname === '/health' || url.pathname === '/api/status') && req.method === 'GET') {
        let dbOk = false;
        let dbBuiltAt = dbBuilt;
        let docsCount = 0;
        let provsCount = 0;
        let syncInfo: any = null;

        try {
          db.prepare('SELECT 1').get();
          dbOk = true;

          const metaRow = db.prepare("SELECT value FROM db_metadata WHERE key IN ('built_at', 'build_date') ORDER BY CASE WHEN key = 'built_at' THEN 1 ELSE 2 END ASC LIMIT 1").get() as { value: string } | undefined;
          if (metaRow?.value) dbBuiltAt = metaRow.value;

          const dRow = db.prepare("SELECT count(*) as c FROM legal_documents").get() as { c: number } | undefined;
          docsCount = dRow?.c ?? 0;

          const pRow = db.prepare("SELECT count(*) as c FROM legal_provisions").get() as { c: number } | undefined;
          provsCount = pRow?.c ?? 0;
        } catch { /* DB hiba */ }

        // Last sync infó beolvasása ha létezik
        try {
          const syncCandidates = [
            join(__dirname, '..', 'data', 'last_sync.json'),
            join(__dirname, '..', '..', 'data', 'last_sync.json'),
            join(process.cwd(), 'data', 'last_sync.json'),
          ];
          const syncPath = syncCandidates.find(p => existsSync(p));
          if (syncPath) {
            syncInfo = JSON.parse(readFileSync(syncPath, 'utf-8'));
          }
        } catch { /* nem kritikus */ }

        let legislationStateDate = syncInfo?.legislation_state_date || 'Ismeretlen';
        try {
          const legRow = db.prepare("SELECT value FROM db_metadata WHERE key = 'legislation_state_date'").get() as { value: string } | undefined;
          if (legRow?.value) legislationStateDate = legRow.value;
        } catch { /* DB hiba */ }

        // Sync history beolvasása ha létezik
        let syncHistory: any[] = [];
        try {
          const histCandidates = [
            join(__dirname, '..', 'data', 'sync_history.json'),
            join(__dirname, '..', '..', 'data', 'sync_history.json'),
            join(process.cwd(), 'data', 'sync_history.json'),
          ];
          const histPath = histCandidates.find(p => existsSync(p));
          if (histPath) {
            syncHistory = JSON.parse(readFileSync(histPath, 'utf-8'));
          }
        } catch { /* nem kritikus */ }

        // Recent laws beolvasása ha létezik
        let recentLaws: any[] = [];
        try {
          const lawsCandidates = [
            join(__dirname, '..', 'data', 'recent_laws.json'),
            join(__dirname, '..', '..', 'data', 'recent_laws.json'),
            join(process.cwd(), 'data', 'recent_laws.json'),
          ];
          const lawsPath = lawsCandidates.find(p => existsSync(p));
          if (lawsPath) {
            recentLaws = JSON.parse(readFileSync(lawsPath, 'utf-8'));
          }
        } catch { /* nem kritikus */ }

        res.writeHead(dbOk ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: dbOk ? 'ok' : 'degraded',
          server: SERVER_NAME,
          version: SERVER_VERSION,
          uptime_seconds: Math.floor(process.uptime()),
          database: {
            legislation_state_date: legislationStateDate,
            built_at: dbBuiltAt,
            tier: meta.tier || 'free',
            jurisdiction: 'HU',
            source_portal: 'Nemzeti Jogszabálytár (NJT - njt.hu)',
            documents_count: docsCount,
            provisions_count: provsCount,
            last_sync_at: syncInfo?.timestamp || dbBuiltAt,
            last_sync_status: syncInfo?.status || 'UP_TO_DATE',
            last_sync_message: syncInfo?.message || `Adatbázis aktív és működőképes (Hatályos jogszabályi állapot: ${legislationStateDate})`,
            sync_history: syncHistory,
            recent_laws: recentLaws,
          },
        }));
        return;
      }

      // POST /api/sync - Manuális szinkron indítása
      if (url.pathname === '/api/sync' && req.method === 'POST') {
        const syncCandidates = [
          join(__dirname, '..', 'scripts', 'daily-sync.js'),
          join(__dirname, 'daily-sync.js'),
          join(__dirname, 'scripts', 'daily-sync.js'),
          join(__dirname, '..', 'daily-sync.js'),
        ];
        const syncScriptPath = syncCandidates.find(p => existsSync(p)) || syncCandidates[0];
        if (!existsSync(syncScriptPath)) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: `A daily-sync.js szkript nem található (${syncScriptPath}).` }));
          return;
        }

        try {
          const { exec } = await import('child_process');
          const { promisify } = await import('util');
          const execAsync = promisify(exec);
          
          await execAsync(`node "${syncScriptPath}"`);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Szinkronizáció sikeresen lefutott' }));
        } catch (err: any) {
          console.error(`[${SERVER_NAME}] Szinkronizációs hiba:`, err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message || 'Hiba a szinkronizáció során' }));
        }
        return;
      }

      // /mcp — MCP Streamable HTTP transport
      if (url.pathname === '/mcp') {
        const sessionId = validSessionId(req.headers['mcp-session-id'] as string | undefined);

        // Existing session — delegate
        if (sessionId && sessions.has(sessionId)) {
          await sessions.get(sessionId)!.handleRequest(req, res);
          return;
        }

        // DELETE — session termination (no existing session found)
        if (req.method === 'DELETE') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session not found' }));
          return;
        }

        // POST — new session (initialize)
        if (req.method === 'POST') {
          // Pre-generate sessionId so we can store it before handleRequest.
          // This eliminates a race where the client sends a follow-up request
          // between handleRequest completing and sessions.set() executing.
          const newSessionId = randomUUID();
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => newSessionId,
          });

          sessions.set(newSessionId, transport);

          transport.onclose = () => {
            sessions.delete(newSessionId);
          };

          const server = createMCPServer();
          await server.connect(transport);
          await transport.handleRequest(req, res);
          return;
        }

        // GET without session — metadata
        if (req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            name: SERVER_NAME,
            version: SERVER_VERSION,
            protocol: 'mcp',
            transport: 'streamable-http',
          }));
          return;
        }

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad request — missing or invalid session' }));
        return;
      }

      // 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (error) {
      console.error(`[${SERVER_NAME}] Unhandled error:`, error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    }
  });

  httpServer.listen(PORT, () => {
    console.error(`${SERVER_NAME} v${SERVER_VERSION} HTTP server listening on port ${PORT}`);

    if (process.env.ENABLE_BACKGROUND_SYNC === 'true') {
      console.error(`[${SERVER_NAME}] Autonóm háttér-szinkronizáció aktív (napi ütemezés).`);
      
      const runSyncJob = async () => {
        const syncCandidates = [
          join(__dirname, '..', 'scripts', 'daily-sync.js'),
          join(__dirname, 'daily-sync.js'),
          join(__dirname, 'scripts', 'daily-sync.js'),
          join(__dirname, '..', 'daily-sync.js'),
        ];
        const syncScriptPath = syncCandidates.find(p => existsSync(p));
        if (!syncScriptPath) {
          console.warn(`[${SERVER_NAME}] Háttér-szinkronizáció: daily-sync.js nem található.`);
          return;
        }

        try {
          const { exec } = await import('child_process');
          const { promisify } = await import('util');
          const execAsync = promisify(exec);
          console.log(`[${SERVER_NAME}] Automatikus napi szinkronizáció indítása...`);
          const { stdout } = await execAsync(`node "${syncScriptPath}"`);
          console.log(`[${SERVER_NAME}] Napi szinkronizáció befejeződött:`, stdout.slice(-200).trim());
        } catch (err: any) {
          console.error(`[${SERVER_NAME}] Hiba a háttér-szinkronizáció során:`, err.message);
        }
      };

      // Indulás után 2 perccel lefut egyszer, majd 24 óránként (86 400 000 ms)
      setTimeout(runSyncJob, 120_000);
      setInterval(runSyncJob, 24 * 60 * 60 * 1000);
    }
  });

  // -------------------------------------------------------------------------
  // Graceful shutdown
  // -------------------------------------------------------------------------

  const shutdown = (signal: string) => {
    console.error(`[${SERVER_NAME}] Shutting down (${signal})...`);
    for (const [, t] of sessions) t.close().catch(() => {});
    sessions.clear();
    try { db.close(); } catch { /* ignore */ }
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
