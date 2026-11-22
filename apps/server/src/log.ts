export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let minLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

export interface Logger {
  debug(message: string, ...extra: unknown[]): void;
  info(message: string, ...extra: unknown[]): void;
  warn(message: string, ...extra: unknown[]): void;
  error(message: string, ...extra: unknown[]): void;
  child(scope: string): Logger;
}

export function createLogger(scope: string): Logger {
  const write = (level: LogLevel, message: string, extra: unknown[]) => {
    if (ORDER[level] < ORDER[minLevel]) return;
    const time = new Date().toISOString().slice(11, 23);
    const line = `${time} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
    const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    sink(line, ...extra);
  };
  return {
    debug: (m, ...e) => write('debug', m, e),
    info: (m, ...e) => write('info', m, e),
    warn: (m, ...e) => write('warn', m, e),
    error: (m, ...e) => write('error', m, e),
    child: (sub) => createLogger(`${scope}:${sub}`),
  };
}

/** Logger that discards everything (tests). */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};
