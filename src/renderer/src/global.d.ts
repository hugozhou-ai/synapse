import type { SynapseApi } from "@shared/synapse-api";

declare global { interface Window { synapse: SynapseApi; } }
export {};
