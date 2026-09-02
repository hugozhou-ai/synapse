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

type SequenceOperation<T> = { kind: "equal" | "add" | "remove"; value: T };
const MAX_MYERS_EDIT_DISTANCE = 512;

function sequenceDiff<T>(before: readonly T[], after: readonly T[]): Array<{ kind: "equal" | "add" | "remove"; value: T }> {
  let prefixLength = 0;
  while (prefixLength < before.length && prefixLength < after.length && before[prefixLength] === after[prefixLength]) prefixLength += 1;
  let suffixLength = 0;
  while (
    suffixLength < before.length - prefixLength
    && suffixLength < after.length - prefixLength
    && before[before.length - suffixLength - 1] === after[after.length - suffixLength - 1]
  ) suffixLength += 1;

  const prefix = before.slice(0, prefixLength).map((value) => ({ kind: "equal" as const, value }));
  const oldMiddle = before.slice(prefixLength, before.length - suffixLength);
  const newMiddle = after.slice(prefixLength, after.length - suffixLength);
  const middle = myersDiff(oldMiddle, newMiddle)
    ?? [...oldMiddle.map((value) => ({ kind: "remove" as const, value })), ...newMiddle.map((value) => ({ kind: "add" as const, value }))];
  const suffix = before.slice(before.length - suffixLength).map((value) => ({ kind: "equal" as const, value }));
  return [...prefix, ...middle, ...suffix];
}

function myersDiff<T>(before: readonly T[], after: readonly T[]): SequenceOperation<T>[] | null {
  if (before.length === 0) return after.map((value) => ({ kind: "add", value }));
  if (after.length === 0) return before.map((value) => ({ kind: "remove", value }));
  const maximumDistance = Math.min(before.length + after.length, MAX_MYERS_EDIT_DISTANCE);
  const frontier = new Map<number, number>([[1, 0]]);
  const trace: Array<ReadonlyMap<number, number>> = [];
  for (let distance = 0; distance <= maximumDistance; distance += 1) {
    trace.push(new Map(frontier));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      let left = diagonal === -distance || (diagonal !== distance && frontierValue(frontier, diagonal - 1) < frontierValue(frontier, diagonal + 1))
        ? frontierValue(frontier, diagonal + 1)
        : frontierValue(frontier, diagonal - 1) + 1;
      let right = left - diagonal;
      while (left < before.length && right < after.length && before[left] === after[right]) { left += 1; right += 1; }
      frontier.set(diagonal, left);
      if (left >= before.length && right >= after.length) return backtrackMyers(trace, before, after);
    }
  }
  return null;
}

function backtrackMyers<T>(trace: readonly ReadonlyMap<number, number>[], before: readonly T[], after: readonly T[]): SequenceOperation<T>[] {
  const reversed: SequenceOperation<T>[] = [];
  let left = before.length;
  let right = after.length;
  for (let distance = trace.length - 1; distance >= 0; distance -= 1) {
    const frontier = trace[distance]!;
    const diagonal = left - right;
    const previousDiagonal = diagonal === -distance || (diagonal !== distance && frontierValue(frontier, diagonal - 1) < frontierValue(frontier, diagonal + 1))
      ? diagonal + 1
      : diagonal - 1;
    const previousLeft = frontierValue(frontier, previousDiagonal);
    const previousRight = previousLeft - previousDiagonal;
    while (left > previousLeft && right > previousRight) {
      reversed.push({ kind: "equal", value: before[left - 1]! });
      left -= 1; right -= 1;
    }
    if (distance === 0) break;
    if (left === previousLeft) {
      right -= 1;
      reversed.push({ kind: "add", value: after[right]! });
    } else {
      left -= 1;
      reversed.push({ kind: "remove", value: before[left]! });
    }
  }
  return reversed.reverse();
}

function frontierValue(frontier: ReadonlyMap<number, number>, diagonal: number): number {
  return frontier.get(diagonal) ?? Number.NEGATIVE_INFINITY;
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
