import type { SummaryContentView, SummaryVersionView } from "@application/contracts";

export type DiffPart = { readonly value: string; readonly changed: boolean };
export type DiffRow = {
  readonly kind: "context" | "added" | "removed" | "modified";
  readonly oldLine: string | null;
  readonly newLine: string | null;
  readonly oldParts?: readonly DiffPart[];
  readonly newParts?: readonly DiffPart[];
};

export interface ContentDiff {
  readonly rows: readonly DiffRow[];
  readonly stats: { readonly added: number; readonly removed: number; readonly modified: number };
}

export const emptySummaryContent: SummaryContentView = { title: "", abstract: "", bodyMarkdown: "", tags: [] };

export function diffSummaryContent(before: SummaryContentView, after: SummaryContentView): ContentDiff {
  const operations = sequenceDiff(lines(before.bodyMarkdown), lines(after.bodyMarkdown));
  const rows: DiffRow[] = [];
  for (let index = 0; index < operations.length;) {
    const operation = operations[index]!;
    if (operation.kind === "equal") {
      rows.push({ kind: "context", oldLine: operation.value, newLine: operation.value });
      index += 1;
      continue;
    }
    const removed: string[] = [];
    const added: string[] = [];
    while (index < operations.length && operations[index]!.kind !== "equal") {
      const change = operations[index]!;
      if (change.kind === "remove") removed.push(change.value); else added.push(change.value);
      index += 1;
    }
    const paired = Math.min(removed.length, added.length);
    for (let pair = 0; pair < paired; pair += 1) {
      const oldLine = removed[pair]!; const newLine = added[pair]!;
      const parts = diffWords(oldLine, newLine);
      rows.push({ kind: "modified", oldLine, newLine, oldParts: parts.before, newParts: parts.after });
    }
    for (const value of removed.slice(paired)) rows.push({ kind: "removed", oldLine: value, newLine: null });
    for (const value of added.slice(paired)) rows.push({ kind: "added", oldLine: null, newLine: value });
  }
  return {
    rows,
    stats: {
      added: rows.filter((row) => row.kind === "added").length,
      removed: rows.filter((row) => row.kind === "removed").length,
      modified: rows.filter((row) => row.kind === "modified").length,
    },
  };
}

export function contributionVersions(versions: readonly SummaryVersionView[], baseSequence: number | null, targetSequence: number): readonly SummaryVersionView[] {
  return versions.filter((version) => version.sequence > (baseSequence ?? -1) && version.sequence <= targetSequence)
    .sort((left, right) => left.sequence - right.sequence);
}

function lines(value: string): string[] { return value === "" ? [] : value.split("\n"); }

function sequenceDiff<T>(before: readonly T[], after: readonly T[]): Array<{ kind: "equal" | "add" | "remove"; value: T }> {
  const lengths = Array.from({ length: before.length + 1 }, () => Array<number>(after.length + 1).fill(0));
  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      lengths[left]![right] = before[left] === after[right]
        ? lengths[left + 1]![right + 1]! + 1
        : Math.max(lengths[left + 1]![right]!, lengths[left]![right + 1]!);
    }
  }
  const result: Array<{ kind: "equal" | "add" | "remove"; value: T }> = [];
  let left = 0; let right = 0;
  while (left < before.length && right < after.length) {
    if (before[left] === after[right]) { result.push({ kind: "equal", value: before[left]! }); left += 1; right += 1; }
    else if (lengths[left + 1]![right]! >= lengths[left]![right + 1]!) { result.push({ kind: "remove", value: before[left]! }); left += 1; }
    else { result.push({ kind: "add", value: after[right]! }); right += 1; }
  }
  while (left < before.length) { result.push({ kind: "remove", value: before[left]! }); left += 1; }
  while (right < after.length) { result.push({ kind: "add", value: after[right]! }); right += 1; }
  return result;
}

function diffWords(before: string, after: string): { before: DiffPart[]; after: DiffPart[] } {
  const oldTokens = tokens(before); const newTokens = tokens(after);
  const operations = sequenceDiff(oldTokens, newTokens);
  return {
    before: operations.filter((part) => part.kind !== "add").map((part) => ({ value: part.value, changed: part.kind === "remove" })),
    after: operations.filter((part) => part.kind !== "remove").map((part) => ({ value: part.value, changed: part.kind === "add" })),
  };
}

function tokens(value: string): string[] {
  return value.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
}
