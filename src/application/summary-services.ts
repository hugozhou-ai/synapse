import type { SummaryContextService } from "@domain/services";
import type { CodexConversation } from "@domain/conversation";
import type { CodexSessionAggregate } from "@domain/session";
import { SourceRevision, SummaryDocumentAggregate, SummaryVersion } from "@domain/summary";
import { DomainError } from "@domain/shared";
import type {
  Clock, CodexSessionRepository, IdGenerator, OutboxRepository, PublicationRepository,
  SummaryAgentGateway, SummaryDocumentRepository, SummaryJobRepository, SummaryProfileRepository,
  SummaryPublisher, TurnSelectionValidator, UnitOfWork,
} from "./ports";
import type {
  FinalizeSummaryCommand, GenerateSummaryCommand, RegenerateSummaryCommand, SummaryDraft, UpdateDraftCommand,
} from "./contracts";

export interface SummaryGenerationService {
  generateDraft(command: GenerateSummaryCommand): Promise<SummaryDraft>;
  regenerate(command: RegenerateSummaryCommand): Promise<SummaryDraft>;
  cancel(jobId: string): Promise<void>;
}

export interface SummaryDeletionService {
  delete(documentId: string): Promise<void>;
}

export class TransactionalSummaryDeletionService implements SummaryDeletionService {
  constructor(
    private readonly summaries: SummaryDocumentRepository,
    private readonly sessions: CodexSessionRepository,
    private readonly outbox: OutboxRepository,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async delete(documentId: string): Promise<void> {
    await this.unitOfWork.execute(async () => {
      const document = await this.summaries.findById(documentId);
      if (!document) throw new DomainError("SUMMARY_NOT_FOUND", "Summary document does not exist.");
      await this.outbox.deleteAggregate("notes-sync", documentId);
      await this.summaries.delete(documentId);
      if (await this.summaries.findLatestBySessionId(document.snapshot.sessionId)) return;
      const session = await this.sessions.findById(document.snapshot.sessionId);
      if (session) {
        session.reopenAfterSummaryDeletion();
        await this.sessions.save(session);
      }
    });
  }
}

export class ProfileDrivenSummaryGenerationService implements SummaryGenerationService {
  constructor(
    private readonly selections: TurnSelectionValidator,
    private readonly contexts: SummaryContextService,
    private readonly agent: SummaryAgentGateway,
    private readonly profiles: SummaryProfileRepository,
    private readonly summaries: SummaryDocumentRepository,
    private readonly sessions: CodexSessionRepository,
    private readonly jobs: SummaryJobRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly onJobsChanged: () => void,
  ) {}

  async generateDraft(command: GenerateSummaryCommand): Promise<SummaryDraft> {
    const session = await this.sessions.findById(command.sessionId);
    if (!session) throw new DomainError("SESSION_NOT_FOUND", "Session does not exist.");
    const profile = await this.profiles.findById(command.profileId);
    if (!profile) throw new DomainError("PROFILE_NOT_FOUND", "Summary profile does not exist.");
    const selection = this.selections.create(session.turns, command.selectedTurnIds);
    const context = await this.contexts.build(toStoredConversation(session), selection);
    const now = this.clock.now();
    const document = SummaryDocumentAggregate.create({
      id: this.ids.next(), sessionId: session.id, profileId: profile.id, selection,
      publicationTarget: command.publicationTarget, createdAt: now, updatedAt: now,
    });
    const jobId = this.ids.next();
    await this.unitOfWork.execute(async () => {
      if (await this.jobs.findActiveBySessionId(session.id)) {
        throw new DomainError("SUMMARY_ALREADY_RUNNING", "该会话正在生成总结，请等待完成。");
      }
      await this.summaries.create(document);
      await this.jobs.save({ id: jobId, documentId: document.id, status: "running", error: null, coveredTurnIds: context.sourceTurnIds, stageCoverage: [], createdAt: now, updatedAt: now });
    });
    this.onJobsChanged();
    return this.runAgent(document, profile, context, jobId, command.model);
  }

  async regenerate(command: RegenerateSummaryCommand): Promise<SummaryDraft> {
    const document = await this.summaries.findById(command.documentId);
    if (!document) throw new DomainError("SUMMARY_NOT_FOUND", "Summary document does not exist.");
    const session = await this.sessions.findById(document.snapshot.sessionId);
    const profile = await this.profiles.findById(command.profileId);
    if (!session || !profile) throw new DomainError("SUMMARY_SOURCE_NOT_FOUND", "Summary source no longer exists.");
    const selection = this.selections.create(session.turns, command.selectedTurnIds);
    const context = await this.contexts.build(toStoredConversation(session), selection);
    const jobId = this.ids.next(); const now = this.clock.now();
    await this.unitOfWork.execute(async () => {
      if (await this.jobs.findActiveBySessionId(session.id)) {
        throw new DomainError("SUMMARY_ALREADY_RUNNING", "该会话正在生成总结，请等待完成。");
      }
      await this.jobs.save({ id: jobId, documentId: document.id, status: "running", error: null, coveredTurnIds: context.sourceTurnIds, stageCoverage: [], createdAt: now, updatedAt: now });
    });
    this.onJobsChanged();
    return this.runAgent(document, profile, context, jobId, command.model, selection);
  }

  async cancel(jobId: string): Promise<void> {
    await this.agent.cancel(jobId);
    const job = await this.jobs.findById(jobId);
    if (job) {
      await this.jobs.save({ ...job, status: "canceled", updatedAt: this.clock.now() });
      this.onJobsChanged();
    }
  }

  private async runAgent(
    document: SummaryDocumentAggregate,
    profile: NonNullable<Awaited<ReturnType<SummaryProfileRepository["findById"]>>>,
    context: Awaited<ReturnType<SummaryContextService["build"]>>,
    jobId: string,
    model: string | null,
    regeneratedSelection?: ReturnType<TurnSelectionValidator["create"]>,
  ): Promise<SummaryDraft> {
    try {
      const generated = await this.agent.generate({ jobId, context, profile, model });
      const now = this.clock.now();
      const version = new SummaryVersion({
        id: this.ids.next(), documentId: document.id, sequence: document.snapshot.versions.length,
        kind: "agent-draft", content: { title: generated.title, abstract: generated.abstract, bodyMarkdown: generated.bodyMarkdown, tags: generated.tags }, sourceRevision: new SourceRevision(context.sourceTurnIds, context.sourceHash),
        model: generated.model, createdAt: now,
      });
      if (regeneratedSelection) document.addRegeneratedDraft(version, profile.id, regeneratedSelection);
      else document.addDraft(version);
      await this.unitOfWork.execute(async () => {
        await this.summaries.save(document);
        const job = await this.jobs.findById(jobId);
        if (job) await this.jobs.save({ ...job, status: "succeeded", stageCoverage: generated.stages, updatedAt: now });
      });
      this.onJobsChanged();
      return { documentId: document.id, versionId: version.props.id, content: version.props.content };
    } catch (error) {
      const job = await this.jobs.findById(jobId);
      if (job) await this.jobs.save({ ...job, status: "failed", error: error instanceof Error ? error.message : String(error), updatedAt: this.clock.now() });
      this.onJobsChanged();
      throw error;
    }
  }
}

function toStoredConversation(session: CodexSessionAggregate): CodexConversation {
  return {
    threadId: session.threadId,
    turns: session.turns.map((turn) => ({
      id: turn.id,
      sequence: turn.sequence,
      status: turn.status,
      startedAt: turn.props.startedAt,
      completedAt: turn.props.completedAt,
      items: [
        ...(turn.props.promptContent ? [{ type: "user" as const, text: turn.props.promptContent }] : []),
        ...(turn.props.assistantContent ? [{ type: "agent" as const, text: turn.props.assistantContent }] : []),
      ],
    })),
  };
}

export interface SummaryFinalizationService {
  updateDraft(command: UpdateDraftCommand): Promise<SummaryDraft>;
  finalize(command: FinalizeSummaryCommand): Promise<SummaryVersion>;
}

export class VersionedSummaryFinalizationService implements SummaryFinalizationService {
  constructor(
    private readonly summaries: SummaryDocumentRepository,
    private readonly sessions: CodexSessionRepository,
    private readonly outbox: OutboxRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async updateDraft(command: UpdateDraftCommand): Promise<SummaryDraft> {
    const document = await this.requireDocument(command.documentId);
    const source = document.currentVersion;
    if (!source) throw new DomainError("DRAFT_NOT_FOUND", "Summary draft does not exist.");
    const version = new SummaryVersion({
      ...source.props, id: this.ids.next(), sequence: document.snapshot.versions.length,
      kind: "edited-draft", content: command.content, createdAt: this.clock.now(),
    });
    document.addDraft(version);
    await this.summaries.save(document);
    return { documentId: document.id, versionId: version.props.id, content: version.props.content };
  }

  async finalize(command: FinalizeSummaryCommand): Promise<SummaryVersion> {
    const document = await this.requireDocument(command.documentId);
    if (command.syncToNotes && !document.snapshot.publicationTarget) {
      throw new DomainError("NOTES_TARGET_REQUIRED", "同步到 Apple Notes 前必须选择账户和文件夹。");
    }
    const source = document.currentVersion;
    if (!source) throw new DomainError("DRAFT_NOT_FOUND", "Summary draft does not exist.");
    const now = this.clock.now();
    const version = new SummaryVersion({
      ...source.props, id: this.ids.next(), sequence: document.snapshot.versions.length,
      kind: "final", content: command.content, createdAt: now,
    });
    document.finalize(version, command.syncToNotes);
    await this.unitOfWork.execute(async () => {
      await this.summaries.save(document);
      const session = await this.sessions.findById(document.snapshot.sessionId);
      if (session) { session.markSummarized(now); await this.sessions.save(session); }
      if (command.syncToNotes) {
        await this.outbox.add({ id: this.ids.next(), kind: "notes-sync", aggregateId: document.id, payload: { versionId: version.props.id }, createdAt: now, processedAt: null, attempts: 0, lastError: null });
      }
    });
    return version;
  }

  private async requireDocument(id: string): Promise<SummaryDocumentAggregate> {
    const document = await this.summaries.findById(id);
    if (!document) throw new DomainError("SUMMARY_NOT_FOUND", "Summary document does not exist.");
    return document;
  }
}

export interface SummaryPublicationService {
  publishCurrent(documentId: string): Promise<void>;
  retry(documentId: string): Promise<void>;
}

export class OutboxSummaryPublicationService implements SummaryPublicationService {
  constructor(
    private readonly summaries: SummaryDocumentRepository,
    private readonly publications: PublicationRepository,
    private readonly publisher: SummaryPublisher,
    private readonly clock: Clock,
    private readonly outbox?: OutboxRepository,
  ) {}

  async publishCurrent(documentId: string): Promise<void> {
    const document = await this.summaries.findById(documentId);
    const version = document?.currentVersion;
    const target = document?.snapshot.publicationTarget;
    if (!document || !version?.isFinal || !target) throw new DomainError("SUMMARY_NOT_PUBLISHABLE", "A final summary and Apple Notes target are required.");
    const existing = await this.publications.find(documentId, "apple-notes");
    try {
      const receipt = await this.publisher.publish({ documentId, version, target, existingExternalId: existing?.externalId ?? null });
      const now = this.clock.now();
      await this.publications.save({ documentId, publisher: "apple-notes", externalId: receipt.externalId, target, versionId: version.props.id, status: "published", error: null, updatedAt: now });
      document.markPublished(now); await this.summaries.save(document);
      await this.outbox?.markAggregateProcessed("notes-sync", documentId, now);
    } catch (error) {
      const now = this.clock.now();
      await this.publications.save({ documentId, publisher: "apple-notes", externalId: existing?.externalId ?? null, target, versionId: version.props.id, status: "failed", error: error instanceof Error ? error.message : String(error), updatedAt: now });
      document.markPublicationFailed(now); await this.summaries.save(document);
      throw error;
    }
  }

  async retry(documentId: string): Promise<void> {
    await this.publishCurrent(documentId);
  }
}
