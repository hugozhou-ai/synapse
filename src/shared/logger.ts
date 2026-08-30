export type LogPrefix = "[synapse:hook]" | "[synapse:app-server]" | "[synapse:notes]" | "[synapse:sqlite]" | "[synapse:ipc]" | "[synapse:main]";

export interface Logger {
  info(prefix: LogPrefix, message: string, fields?: unknown): void;
  error(prefix: LogPrefix, message: string, fields?: unknown): void;
}

export class JsonConsoleLogger implements Logger {
  info(prefix: LogPrefix, message: string, fields: unknown = {}): void {
    console.info(`${prefix} ${message} ${JSON.stringify(fields)}`);
  }
  error(prefix: LogPrefix, message: string, fields: unknown = {}): void {
    console.error(`${prefix} ${message} ${JSON.stringify(fields)}`);
  }
}
