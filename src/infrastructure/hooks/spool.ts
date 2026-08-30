import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface HookEventSpool {
  append(raw: string): Promise<void>;
  replay(consumer: (raw: string) => Promise<void>): Promise<{ replayed: number; failed: number }>;
}

export class FileSystemHookEventSpool implements HookEventSpool {
  constructor(private readonly directory: string) {}
  async append(raw: string): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, `${new Date().toISOString().replaceAll(":", "-")}-${process.pid}-${crypto.randomUUID()}.json`);
    await writeFile(path, raw, { mode: 0o600 }); await chmod(path, 0o600);
  }
  async replay(consumer: (raw: string) => Promise<void>): Promise<{ replayed: number; failed: number }> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const candidates = (await readdir(this.directory)).filter((name) => name.endsWith(".json") && !name.startsWith("."));
    const timed = await Promise.all(candidates.map(async (name) => ({ name, modifiedAt: (await stat(join(this.directory, name))).mtimeMs })));
    const names = timed.sort((left, right) => left.modifiedAt - right.modifiedAt || left.name.localeCompare(right.name)).map((item) => item.name);
    let replayed = 0; let failed = 0;
    for (const name of names) {
      const path = join(this.directory, name);
      try { await consumer(await readFile(path, "utf8")); await rm(path); replayed += 1; }
      catch { failed += 1; }
    }
    return { replayed, failed };
  }
}
