// ════════════════════════════════════════════════════════════════════════════
//  logger.ts: small structured logger. Never logs secrets or tokens (callers
//  must pass redacted refs). Timestamped, JSON-tail for structured fields.
// ════════════════════════════════════════════════════════════════════════════
type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, msg: string, extra?: Record<string, unknown>): void {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (m: string, e?: Record<string, unknown>) => emit('debug', m, e),
  info: (m: string, e?: Record<string, unknown>) => emit('info', m, e),
  warn: (m: string, e?: Record<string, unknown>) => emit('warn', m, e),
  error: (m: string, e?: Record<string, unknown>) => emit('error', m, e),
};
