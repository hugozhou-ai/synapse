import type { SummaryContextService } from "@domain/services";
import type { CodexConversation, SummaryContext } from "@domain/conversation";
import type { CodexSessionAggregate } from "@domain/session";
import { SourceRevision, SummaryDocumentAggregate, SummaryVersion, type SummaryContent, type SummaryProfile } from "@domain/summary";
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
      const sourceSessionIds = [...new Set(document.snapshot.versions
        .filter((version) => version.isFinal)
        .map((version) => version.props.sourceRevision.sessionId))];
      await this.outbox.deleteAggregate("notes-sync", documentId);
      await this.summaries.delete(documentId);
      for (const sessionId of sourceSessionIds) {
        if (await this.summaries.hasFinalBySessionId(sessionId)) continue;
        const session = await this.sessions.findById(sessionId);
        if (session) {
          session.reopenAfterSummaryDeletion();
          await this.sessions.save(session);
        }
      }
    });
  }
}

export class DestinationAwareSummaryGenerationService implements SummaryGenerationService {
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
    const selection = this.selections.create(session.turns, command.selectedTurnIds);
    const context = await this.contexts.build(toStoredConversation(session), selection);
    const jobId = this.ids.next();
    const now = this.clock.now();
    const destination = command.destination;
    let input: AgentRunInput;
    if (destination.kind === "new") {
      const profile = await this.profiles.findById(destination.profileId);
      if (!profile) throw new DomainError("PROFILE_NOT_FOUND", "Summary profile does not exist.");
      const document = SummaryDocumentAggregate.create({
        id: this.ids.next(), sessionId: session.id, profileId: profile.id, selection,
        publicationTarget: destination.publicationTarget, createdAt: now, updatedAt: now,
      });
      await this.unitOfWork.execute(async () => {
        await this.assertJobAvailable(session.id, document.id);
        await this.summaries.create(document);
        await this.jobs.save(runningJob(jobId, document.id, session.id, "new", null, context, now));
      });
      input = {
        documentId: document.id, sourceSessionId: session.id, expectedVersionId: null, versionBaseVersionId: null,
        generationMode: "new", profile, context, jobId, model: command.model,
      };
    } else {
      input = await this.unitOfWork.execute(async () => {
        const document = await this.summaries.findById(destination.targetDocumentId);
        const target = document?.currentVersion;
        if (!document || !target) throw new DomainError("SUMMARY_TARGET_NOT_FOUND", "选择的已有内容不存在或还没有可整理的版本。");
        await this.assertJobAvailable(session.id, document.id);
        await this.jobs.save(runningJob(jobId, document.id, session.id, "merge", target.props.id, context, now));
        return {
          documentId: document.id, sourceSessionId: session.id, expectedVersionId: target.props.id, versionBaseVersionId: target.props.id,
          generationMode: "merge" as const, target: { versionId: target.props.id, content: target.props.content }, context, jobId, model: command.model,
        };
      });
    }
    this.onJobsChanged();
    return this.runAgent(input);
  }

  async regenerate(command: RegenerateSummaryCommand): Promise<SummaryDraft> {
    const document = await this.summaries.findById(command.documentId);
    const current = document?.currentVersion;
    if (!document || !current) throw new DomainError("SUMMARY_NOT_FOUND", "Summary document does not exist.");
    const session = await this.sessions.findById(current.props.sourceRevision.sessionId);
    if (!session) throw new DomainError("SUMMARY_SOURCE_NOT_FOUND", "Summary source no longer exists.");
    const selection = this.selections.create(session.turns, current.props.sourceRevision.turnIds);
    const context = await this.contexts.build(toStoredConversation(session), selection);
    const jobId = this.ids.next(); const now = this.clock.now();
    let input: AgentRunInput;
    if (current.props.generationMode === "new") {
      const profile = await this.profiles.findById(document.snapshot.profileId);
      if (!profile) throw new DomainError("PROFILE_NOT_FOUND", "Summary profile does not exist.");
      input = {
        documentId: document.id, sourceSessionId: session.id, expectedVersionId: current.props.id, versionBaseVersionId: null,
        generationMode: "new", profile, context, jobId, model: command.model,
      };
    } else {
      const base = current.props.baseVersionId ? document.version(current.props.baseVersionId) : null;
      if (!base) throw new DomainError("SUMMARY_BASE_VERSION_NOT_FOUND", "融合所依据的原版本不存在，无法重新生成。");
      input = {
        documentId: document.id, sourceSessionId: session.id, expectedVersionId: current.props.id, versionBaseVersionId: base.props.id,
        generationMode: "merge", target: { versionId: base.props.id, content: base.props.content }, context, jobId, model: command.model,
      };
    }
    await this.unitOfWork.execute(async () => {
      const fresh = await this.summaries.findById(document.id);
      if (fresh?.snapshot.currentVersionId !== current.props.id) throw targetChangedError();
      await this.assertJobAvailable(session.id, document.id);
      await this.jobs.save(runningJob(jobId, document.id, session.id, current.props.generationMode, current.props.id, context, now));
    });
    this.onJobsChanged();
    return this.runAgent(input);
  }

  async cancel(jobId: string): Promise<void> {
    await this.agent.cancel(jobId);
    const job = await this.jobs.findById(jobId);
    if (job) {
      await this.jobs.save({ ...job, status: "canceled", updatedAt: this.clock.now() });
      this.onJobsChanged();
    }
  }

  private async runAgent(input: AgentRunInput): Promise<SummaryDraft> {
    try {
      const generated = input.generationMode === "new"
        ? await this.agent.generate({ jobId: input.jobId, context: input.context, model: input.model, generationMode: "new", profile: input.profile })
        : await this.agent.generate({ jobId: input.jobId, context: input.context, model: input.model, generationMode: "merge", target: input.target });
      const now = this.clock.now();
      const version = await this.unitOfWork.execute(async () => {
        const document = await this.summaries.findById(input.documentId);
        if (!document || document.snapshot.currentVersionId !== input.expectedVersionId) throw targetChangedError();
        const next = new SummaryVersion({
          id: this.ids.next(), documentId: document.id, sequence: document.snapshot.versions.length,
          kind: "agent-draft", generationMode: input.generationMode, baseVersionId: input.versionBaseVersionId,
          content: { title: generated.title, abstract: generated.abstract, bodyMarkdown: generated.bodyMarkdown, tags: generated.tags },
          sourceRevision: new SourceRevision(input.sourceSessionId, input.context.sourceTurnIds, input.context.sourceHash),
          model: generated.model, createdAt: now,
        });
        document.addDraft(next);
        await this.summaries.save(document);
        const job = await this.jobs.findById(input.jobId);
        if (job) await this.jobs.save({ ...job, status: "succeeded", stageCoverage: generated.stages, updatedAt: now });
        return next;
      });
      this.onJobsChanged();
      return { documentId: input.documentId, versionId: version.props.id, content: version.props.content };
    } catch (error) {
      const job = await this.jobs.findById(input.jobId);
      if (job) await this.jobs.save({ ...job, status: "failed", error: error instanceof Error ? error.message : String(error), updatedAt: this.clock.now() });
      this.onJobsChanged();
      throw error;
    }
  }

  private async assertJobAvailable(sessionId: string, documentId: string): Promise<void> {
    if (await this.jobs.findActiveBySessionId(sessionId)) {
      throw new DomainError("SUMMARY_ALREADY_RUNNING", "该会话正在生成总结，请等待完成。");
    }
    if (await this.jobs.findActiveByDocumentId(documentId)) {
      throw new DomainError("SUMMARY_TARGET_BUSY", "选择的已有内容正在被整理，请等待完成。");
    }
  }
}

type AgentRunInput = {
  readonly documentId: string;
  readonly sourceSessionId: string;
  readonly expectedVersionId: string | null;
  readonly versionBaseVersionId: string | null;
  readonly context: SummaryContext;
  readonly jobId: string;
  readonly model: string | null;
} & ({
  readonly generationMode: "new";
  readonly profile: SummaryProfile;
} | {
  readonly generationMode: "merge";
  readonly target: { readonly versionId: string; readonly content: SummaryContent };
});

function runningJob(
  id: string,
  documentId: string,
  sourceSessionId: string,
  generationMode: "new" | "merge",
  baseVersionId: string | null,
  context: SummaryContext,
  now: string,
) {
  return {
    id, documentId, sourceSessionId, generationMode, baseVersionId, status: "running" as const, error: null,
    coveredTurnIds: context.sourceTurnIds, stageCoverage: [], createdAt: now, updatedAt: now,
  };
}

function targetChangedError(): DomainError {
  return new DomainError("SUMMARY_TARGET_CHANGED", "目标内容在整理期间已被修改，请重新生成以避免覆盖新版本。");
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
    private readonly publications: PublicationRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async updateDraft(command: UpdateDraftCommand): Promise<SummaryDraft> {
    return this.unitOfWork.execute(async () => {
      const document = await this.requireDocument(command.documentId);
      const source = document.currentVersion;
      if (!source) throw new DomainError("DRAFT_NOT_FOUND", "Summary draft does not exist.");
      if (source.props.id !== command.expectedVersionId) throw targetChangedError();
      const version = new SummaryVersion({
        ...source.props, id: this.ids.next(), sequence: document.snapshot.versions.length,
        kind: "edited-draft", content: command.content, createdAt: this.clock.now(),
      });
      document.addDraft(version);
      await this.summaries.save(document);
      return { documentId: document.id, versionId: version.props.id, content: version.props.content };
    });
  }

  async finalize(command: FinalizeSummaryCommand): Promise<SummaryVersion> {
    return this.unitOfWork.execute(async () => {
      const document = await this.requireDocument(command.documentId);
      const source = document.currentVersion;
      if (!source) throw new DomainError("DRAFT_NOT_FOUND", "Summary draft does not exist.");
      if (source.props.id !== command.expectedVersionId) throw targetChangedError();
      const publication = await this.publications.find(document.id, "apple-notes");
      const shouldPublish = Boolean(publication?.externalId)
        || (source.props.generationMode === "new" && document.snapshot.publicationTarget !== null);
      if (shouldPublish && !document.snapshot.publicationTarget) {
        throw new DomainError("NOTES_TARGET_REQUIRED", "同步到 Apple Notes 前必须选择账户和文件夹。");
      }
      const now = this.clock.now();
      const version = new SummaryVersion({
        ...source.props, id: this.ids.next(), sequence: document.snapshot.versions.length,
        kind: "final", content: command.content, createdAt: now,
      });
      document.finalize(version, shouldPublish);
      await this.summaries.save(document);
      const session = await this.sessions.findById(version.props.sourceRevision.sessionId);
      if (session) { session.markSummarized(now); await this.sessions.save(session); }
      if (shouldPublish) {
        await this.outbox.add({ id: this.ids.next(), kind: "notes-sync", aggregateId: document.id, payload: { versionId: version.props.id }, createdAt: now, processedAt: null, attempts: 0, lastError: null });
      }
      return version;
    });
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
