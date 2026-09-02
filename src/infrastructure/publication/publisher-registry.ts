import type { PublicationPublisherRegistry, SummaryPublisher } from "@application/ports";
import type { PublisherKind } from "@domain/summary";
import { DomainError } from "@domain/shared";

export class FixedPublicationPublisherRegistry implements PublicationPublisherRegistry {
  private readonly publishers: ReadonlyMap<PublisherKind, SummaryPublisher>;

  constructor(publishers: readonly SummaryPublisher[]) {
    this.publishers = new Map(publishers.map((publisher) => [publisher.kind, publisher]));
  }

  get(kind: PublisherKind): SummaryPublisher {
    const publisher = this.publishers.get(kind);
    if (!publisher) throw new DomainError("PUBLISHER_UNAVAILABLE", `Publisher ${kind} is unavailable.`);
    return publisher;
  }
}
