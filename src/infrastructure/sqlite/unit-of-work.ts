import type { UnitOfWork } from "@application/ports";
import type { SynapseDatabase } from "./database";

export class BetterSqliteUnitOfWork implements UnitOfWork {
  constructor(private readonly database: SynapseDatabase) {}

  async execute<T>(work: () => Promise<T>): Promise<T> {
    return this.database.transaction(work);
  }
}
