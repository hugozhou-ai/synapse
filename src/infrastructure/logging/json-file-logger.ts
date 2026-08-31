import { appendFileSync, chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Logger, LogPrefix } from "@shared/logger";
import { formatLogLine } from "@shared/logger";

export class JsonFileLogger implements Logger {
  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    appendFileSync(path, "", { encoding: "utf8", mode: 0o600 });
    chmodSync(path, 0o600);
  }

  info(prefix: LogPrefix, message: string, fields: unknown = {}): void {
    this.write(prefix, "info", message, fields);
  }

  error(prefix: LogPrefix, message: string, fields: unknown = {}): void {
    this.write(prefix, "error", message, fields);
  }

  private write(prefix: LogPrefix, level: "info" | "error", message: string, fields: unknown): void {
    appendFileSync(this.path, `${formatLogLine(prefix, level, message, fields)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}
