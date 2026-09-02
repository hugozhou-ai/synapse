export type LogPrefix = "[synapse:hook]" | "[synapse:app-server]" | "[synapse:notes]" | "[synapse:sqlite]" | "[synapse:ipc]" | "[synapse:main]" | "[synapse:renderer]" | "[synapse:plugin]";

export interface Logger {
  info(prefix: LogPrefix, message: string, fields?: unknown): void;
  error(prefix: LogPrefix, message: string, fields?: unknown): void;
}

export class JsonConsoleLogger implements Logger {
  info(prefix: LogPrefix, message: string, fields: unknown = {}): void {
    console.info(formatLogLine(prefix, "info", message, fields));
  }
  error(prefix: LogPrefix, message: string, fields: unknown = {}): void {
    console.error(formatLogLine(prefix, "error", message, fields));
  }
}

export class CompositeLogger implements Logger {
  constructor(private readonly delegates: readonly Logger[]) {}
  info(prefix: LogPrefix, message: string, fields: unknown = {}): void {
    for (const delegate of this.delegates) delegate.info(prefix, message, fields);
  }
  error(prefix: LogPrefix, message: string, fields: unknown = {}): void {
    for (const delegate of this.delegates) delegate.error(prefix, message, fields);
  }
}

export function formatLogLine(prefix: LogPrefix, level: "info" | "error", message: string, fields: unknown = {}): string {
  return `${prefix} ${JSON.stringify({ timestamp: new Date().toISOString(), level, message, fields })}`;
}
