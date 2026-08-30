import type { UnitOfWork } from "@application/ports";
import type { SynapseDatabase } from "./database";

export class BetterSqliteUnitOfWork implements UnitOfWork {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly database: SynapseDatabase) {}

  async execute<T>(work: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const prior = this.tail;
    this.tail = prior.then(() => gate);
    await prior;
    this.database.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = await work();
      this.database.connection.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.connection.exec("ROLLBACK");
      throw error;
    } finally {
      release();
    }
  }
}
