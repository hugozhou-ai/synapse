import type { CodexConversation, GeneratedSummary, SummaryContext } from "@domain/conversation";
import type { CodexTurn } from "@domain/session";
import type { DomainEvent } from "@domain/shared";
import type {
  PublicationTarget,
  SummaryDocumentAggregate,
  SummaryProfile,
  SummaryVersion,
  TurnSelection,
} from "@domain/summary";
import type { SummaryDocumentRepository as DomainSummaryDocumentRepository } from "@domain/repositories";
import type { NotesTargetsView } from "./contracts";
export type { CodexSessionRepository, CodexTurnRepository, HookEventRepository, SummaryProfileRepository } from "@domain/repositories";

export interface SummaryDocumentRepository extends DomainSummaryDocumentRepository {
  search(input: SummarySearchCriteria): Promise<SummarySearchResult>;
}

export interface SummaryJob {
  readonly id: string;
  readonly documentId: string;
  readonly status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  readonly error: string | null;
  readonly coveredTurnIds: readonly string[];
  readonly stageCoverage: readonly { readonly kind: "chunk" | "final"; readonly turnIds: readonly string[] }[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SummaryJobRepository {
  save(job: SummaryJob): Promise<void>;
  findById(id: string): Promise<SummaryJob | null>;
}

export interface PublicationRecord {
  readonly documentId: string;
  readonly publisher: "apple-notes";
  readonly externalId: string | null;
  readonly target: PublicationTarget;
  readonly versionId: string;
  readonly status: "pending" | "published" | "failed";
  readonly error: string | null;
  readonly updatedAt: string;
}

export interface PublicationRepository {
  find(documentId: string, publisher: "apple-notes"): Promise<PublicationRecord | null>;
  save(record: PublicationRecord): Promise<void>;
}

export interface OutboxMessage {
  readonly id: string;
  readonly kind: "domain-event" | "notes-sync";
  readonly aggregateId: string;
  readonly payload: unknown;
  readonly createdAt: string;
  readonly processedAt: string | null;
  readonly attempts: number;
  readonly lastError: string | null;
}

export interface OutboxRepository {
  add(message: OutboxMessage): Promise<void>;
  listPending(kind: OutboxMessage["kind"], limit: number): Promise<readonly OutboxMessage[]>;
  markProcessed(id: string, at: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  markAggregateProcessed(kind: OutboxMessage["kind"], aggregateId: string, at: string): Promise<void>;
}

export interface UnitOfWork {
  execute<T>(work: () => Promise<T>): Promise<T>;
}

export interface ConversationGateway {
  readConversation(threadId: string): Promise<CodexConversation>;
  waitUntilTurnPersisted(threadId: string, turnId: string): Promise<CodexConversation>;
}

export interface SummaryAgentRequest {
  readonly jobId: string;
  readonly context: SummaryContext;
  readonly profile: SummaryProfile;
  readonly model: string | null;
}

export interface SummaryAgentGateway {
  generate(request: SummaryAgentRequest): Promise<GeneratedSummary>;
  cancel(jobId: string): Promise<void>;
  listModels(): Promise<readonly AgentModel[]>;
}

export interface AgentModel {
  readonly id: string;
  readonly displayName: string;
  readonly isDefault: boolean;
}

export interface PublishSummaryRequest {
  readonly documentId: string;
  readonly version: SummaryVersion;
  readonly target: PublicationTarget;
  readonly existingExternalId: string | null;
}

export interface PublicationReceipt {
  readonly externalId: string;
  readonly updated: boolean;
}

export interface SummaryPublisher {
  readonly kind: "apple-notes";
  publish(request: PublishSummaryRequest): Promise<PublicationReceipt>;
}

export interface NotesTargetGateway {
  listTargets(): Promise<NotesTargetsView>;
}

export interface EventPublisher {
  publish(events: readonly DomainEvent[]): Promise<void>;
}

export interface Clock { now(): string; }
export interface IdGenerator { next(): string; }

export interface SummarySearchCriteria {
  readonly text?: string;
  readonly cwd?: string;
  readonly profileId?: string;
  readonly status?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface SummarySearchItem {
  readonly documentId: string;
  readonly sessionId: string;
  readonly title: string;
  readonly abstract: string;
  readonly tags: readonly string[];
  readonly cwd: string;
  readonly profileId: string;
  readonly versionKind: string;
  readonly updatedAt: string;
}

export interface SummarySearchResult {
  readonly items: readonly SummarySearchItem[];
  readonly total: number;
}

export interface HookInstallationStatus {
  readonly installed: boolean;
  readonly trusted: boolean;
  readonly onboardingRequired: boolean;
  readonly relayPath: string;
  readonly configPath: string;
  readonly trustStates: readonly HookTrustState[];
  readonly message: string | null;
}

export interface HookTrustState {
  readonly cwd: string;
  readonly status: "managed" | "trusted" | "untrusted" | "modified" | "unknown";
  readonly hooks: readonly HookTrustCandidate[];
}

export interface HookTrustCandidate {
  readonly key: string;
  readonly eventName: string;
  readonly command: string;
  readonly currentHash: string;
  readonly status: HookTrustState["status"];
}

export interface OwnedHookSpec { readonly command: string; readonly statusMessage: string; }
export interface HookInstallManifest { readonly command: string; readonly featureEnabledByInstaller: boolean; readonly installedAt: string; }
export interface CodexHookConfiguration { readonly raw: Record<string, unknown>; readonly manifest: HookInstallManifest | null; }

export interface CodexHookConfigStore {
  read(): Promise<CodexHookConfiguration>;
  mergeOwnedHooks(spec: OwnedHookSpec): Promise<HookInstallManifest>;
  removeOwnedHooks(manifest: HookInstallManifest): Promise<void>;
}

export interface HookRelayInstaller {
  readonly relayPath: string;
  install(): Promise<void>;
  uninstall(): Promise<void>;
  exists(): Promise<boolean>;
}

export interface HookTrustGateway {
  inspect(cwds: readonly string[], ownedCommand: string, ownedSourcePath: string): Promise<readonly HookTrustState[]>;
  trust(cwds: readonly string[], ownedCommand: string, ownedSourcePath: string): Promise<void>;
}

export interface ApplicationSettings {
  readonly codexBinaryPath: string | null;
  readonly summaryModel: string | null;
  readonly syncNotesByDefault: boolean;
  readonly notesAccount: string | null;
  readonly notesFolder: string;
  readonly widgetVisible: boolean;
  readonly widgetPositions: Readonly<Record<string, { x: number; y: number }>>;
  readonly widgetDisplayId: string | null;
  readonly hookSetupAcknowledged: boolean;
}

export type ApplicationSettingsUpdate = Partial<Omit<ApplicationSettings, "hookSetupAcknowledged">>;

export interface AppServerRuntimeStatus {
  readonly state: "initializing" | "available" | "unavailable";
  readonly available: boolean;
  readonly binaryPath: string | null;
  readonly version: string | null;
  readonly authentication: "signed-in" | "required" | "not-required" | "unknown";
  readonly error: string | null;
}

export interface AppServerRuntimeStatusProvider {
  current(): Promise<AppServerRuntimeStatus>;
}

export interface SettingsRepository {
  read(): Promise<ApplicationSettings>;
  save(settings: ApplicationSettings): Promise<void>;
}

export interface ExportGateway {
  exportMarkdown(document: SummaryDocumentAggregate): Promise<string | null>;
  exportJson(document: SummaryDocumentAggregate): Promise<string | null>;
  revealDatabaseDirectory(): Promise<void>;
}

export interface TurnSelectionValidator {
  create(availableTurns: readonly CodexTurn[], selectedTurnIds: readonly string[]): TurnSelection;
}
