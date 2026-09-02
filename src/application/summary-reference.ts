import { DomainError } from "@domain/shared";
import type { SummaryDocumentRepository, TextClipboardGateway } from "./ports";

export interface SummaryReferenceView {
  readonly uri: string;
  readonly text: string;
}

export interface SummaryReferenceService {
  create(documentId: string, versionId: string): Promise<SummaryReferenceView>;
  copy(documentId: string, versionId: string): Promise<SummaryReferenceView>;
}

export class RepositorySummaryReferenceService implements SummaryReferenceService {
  constructor(
    private readonly summaries: SummaryDocumentRepository,
    private readonly clipboard: TextClipboardGateway,
  ) {}

  async create(documentId: string, versionId: string): Promise<SummaryReferenceView> {
    const document = await this.summaries.findById(documentId);
    if (!document) throw new DomainError("SUMMARY_NOT_FOUND", "Summary document does not exist.");
    const version = document.version(versionId);
    if (!version) throw new DomainError("SUMMARY_VERSION_NOT_FOUND", "Summary version does not exist in this document.");
    return formatSummaryReference(document.id, version.props.id, version.props.content.title);
  }

  async copy(documentId: string, versionId: string): Promise<SummaryReferenceView> {
    const reference = await this.create(documentId, versionId);
    this.clipboard.writeText(reference.text);
    return reference;
  }
}

export function formatSummaryReference(documentId: string, versionId: string, title: string): SummaryReferenceView {
  if (!documentId || !versionId) throw new DomainError("INVALID_SUMMARY_REFERENCE", "Summary reference identifiers are required.");
  const uri = `synapse://summary/${encodeURIComponent(documentId)}?v=${encodeURIComponent(versionId)}`;
  const label = title.replaceAll(/[\[\]|\r\n]+/g, " ").replaceAll(/\s+/g, " ").trim() || "Untitled summary";
  return { uri, text: `[[Synapse:${label}|${uri}]]` };
}
