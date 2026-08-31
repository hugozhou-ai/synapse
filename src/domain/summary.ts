import { DomainError } from "./shared";

export type SummaryProfileKind = "template" | "systemPrompt";
export type SummaryVersionKind = "agent-draft" | "edited-draft" | "final";
export type PublicationStatus = "not-requested" | "pending" | "published" | "failed";

export class TurnSelection {
  readonly turnIds: readonly string[];

  constructor(turnIds: readonly string[]) {
    const unique = [...new Set(turnIds)];
    if (unique.length === 0) throw new DomainError("EMPTY_TURN_SELECTION", "Select at least one turn.");
    if (unique.length !== turnIds.length) throw new DomainError("DUPLICATE_TURN_SELECTION", "Turn selection contains duplicates.");
    this.turnIds = Object.freeze(unique);
  }
}

export class SummaryProfile {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly kind: SummaryProfileKind,
    readonly instructions: string,
    readonly isDefault: boolean,
  ) {
    if (!id || !name || !instructions.trim()) throw new DomainError("INVALID_PROFILE", "Summary profile is incomplete.");
  }
}

export interface SummaryContent {
  readonly title: string;
  readonly abstract: string;
  readonly bodyMarkdown: string;
  readonly tags: readonly string[];
}

export class SourceRevision {
  constructor(readonly turnIds: readonly string[], readonly contentHash: string) {
    if (turnIds.length === 0 || !contentHash) throw new DomainError("INVALID_SOURCE_REVISION", "Source revision is incomplete.");
  }
}

export class PublicationTarget {
  constructor(readonly account: string | null, readonly folder: string) {
    if (!folder.trim()) throw new DomainError("INVALID_PUBLICATION_TARGET", "Apple Notes folder is required.");
  }
}

export interface SummaryVersionProps {
  readonly id: string;
  readonly documentId: string;
  readonly sequence: number;
  readonly kind: SummaryVersionKind;
  readonly content: SummaryContent;
  readonly sourceRevision: SourceRevision;
  readonly model: string | null;
  readonly createdAt: string;
}

export class SummaryVersion {
  readonly props: SummaryVersionProps;

  constructor(props: SummaryVersionProps) {
    const content = Object.freeze({ ...props.content, tags: Object.freeze([...props.content.tags]) });
    this.props = Object.freeze({ ...props, content });
  }
  get isFinal(): boolean { return this.props.kind === "final"; }
}

export interface SummaryDocumentProps {
  readonly id: string;
  readonly sessionId: string;
  readonly profileId: string;
  readonly selection: TurnSelection;
  readonly versions: readonly SummaryVersion[];
  readonly currentVersionId: string | null;
  readonly publicationTarget: PublicationTarget | null;
  readonly publicationStatus: PublicationStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class SummaryDocumentAggregate {
  constructor(private props: SummaryDocumentProps) {}

  static create(input: Omit<SummaryDocumentProps, "versions" | "currentVersionId" | "publicationStatus">): SummaryDocumentAggregate {
    return new SummaryDocumentAggregate({ ...input, versions: [], currentVersionId: null, publicationStatus: "not-requested" });
  }

  get id(): string { return this.props.id; }
  get snapshot(): SummaryDocumentProps { return this.props; }
  get currentVersion(): SummaryVersion | null {
    return this.props.versions.find((version) => version.props.id === this.props.currentVersionId) ?? null;
  }

  addDraft(version: SummaryVersion): void {
    if (version.isFinal) throw new DomainError("DRAFT_EXPECTED", "A final version cannot be added as a draft.");
    this.assertVersion(version);
    this.props = {
      ...this.props,
      versions: [...this.props.versions, version],
      currentVersionId: version.props.id,
      updatedAt: version.props.createdAt,
    };
  }

  addRegeneratedDraft(version: SummaryVersion, profileId: string, selection: TurnSelection): void {
    if (!profileId) throw new DomainError("PROFILE_REQUIRED", "A regenerated summary requires a profile.");
    if (version.isFinal) throw new DomainError("DRAFT_EXPECTED", "A final version cannot be added as a regenerated draft.");
    this.assertVersion(version);
    this.props = {
      ...this.props,
      profileId,
      selection,
      versions: [...this.props.versions, version],
      currentVersionId: version.props.id,
      updatedAt: version.props.createdAt,
    };
  }

  finalize(version: SummaryVersion, publish: boolean): void {
    if (!version.isFinal) throw new DomainError("FINAL_EXPECTED", "Finalization requires an immutable final version.");
    this.assertVersion(version);
    this.props = {
      ...this.props,
      versions: [...this.props.versions, version],
      currentVersionId: version.props.id,
      publicationStatus: publish ? "pending" : "not-requested",
      updatedAt: version.props.createdAt,
    };
  }

  markPublished(at: string): void {
    this.props = { ...this.props, publicationStatus: "published", updatedAt: at };
  }

  markPublicationFailed(at: string): void {
    this.props = { ...this.props, publicationStatus: "failed", updatedAt: at };
  }

  private assertVersion(version: SummaryVersion): void {
    if (version.props.documentId !== this.id) throw new DomainError("VERSION_DOCUMENT_MISMATCH", "Version belongs to another document.");
    if (this.props.versions.some((item) => item.props.id === version.props.id)) {
      throw new DomainError("VERSION_IMMUTABLE", "A summary version cannot be replaced.");
    }
  }
}
