// ════════════════════════════════════════════════════════════════════════════
//  httpServer.ts: the small internal HTTP endpoint a publisher pings.
//    POST /internal/announce   (HMAC-verified)  → trigger an announce reconcile
//    GET  /health                               → liveness/readiness
//  No express. node:http keeps the dependency surface minimal.
// ════════════════════════════════════════════════════════════════════════════
import http from 'node:http';
import { config } from './config';
import { logger } from './logger';
import { verifyAnnounceHmac } from './util';
import { maybeAnnounce } from './announce';

function readBody(req: http.IncomingMessage, limit = 64 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { req.destroy(); reject(new Error('body too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function startHttpServer(isReady: () => boolean): http.Server {
  const server = http.createServer(async (req, res) => {
    const send = (code: number, obj: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    try {
      if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, ready: isReady() });

      if (req.method === 'POST' && req.url === '/internal/announce') {
        const raw = await readBody(req);
        if (!config.announceHmacSecret) {
          logger.warn('announce push rejected: ANNOUNCE_HMAC_SECRET not set');
          return send(503, { error: 'announce disabled (no secret configured)' });
        }
        const sig = req.headers['x-ssim-signature'];
        if (!verifyAnnounceHmac(config.announceHmacSecret, raw, Array.isArray(sig) ? sig[0] : sig)) {
          logger.warn('announce push rejected: invalid HMAC signature');
          return send(401, { error: 'invalid signature' });
        }
        // The push is a trigger only. The bot re-fetches the release itself and dedupes.
        maybeAnnounce('push');
        return send(202, { ok: true });
      }

      send(404, { error: 'not found' });
    } catch (err) {
      logger.error('http server error', { err: (err as Error).message });
      try { send(500, { error: 'internal' }); } catch { /* headers already sent */ }
    }
  });
  server.listen(config.httpPort, config.httpHost, () => logger.info(`http listening on ${config.httpHost}:${config.httpPort}`));
  return server;
}
