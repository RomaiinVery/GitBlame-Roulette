export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

const write = (level: string, message: string, context?: Record<string, unknown>) => {
  const line = JSON.stringify({ level, time: new Date().toISOString(), message, ...context });
  (level === "error" ? console.error : console.log)(line);
};

/** Logs JSON sur stdout : lisibles par les machines, ignorés par les humains, comme il se doit. */
export const consoleLogger: Logger = {
  info: (message, context) => write("info", message, context),
  warn: (message, context) => write("warn", message, context),
  error: (message, context) => write("error", message, context),
};

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

export const errorContext = (error: unknown): Record<string, unknown> =>
  error instanceof Error ? { error: error.message, cause: (error.cause as Error | undefined)?.message } : { error: String(error) };
