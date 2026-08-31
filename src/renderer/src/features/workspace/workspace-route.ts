export type WorkspaceRoute = "history" | "queue" | "settings" | `history/${string}` | `summary/${string}`;

export interface SummaryWorkspaceRoute {
  readonly sessionId: string;
}

export function parseWorkspaceRoute(value: string): WorkspaceRoute {
  const route = value.replace(/^#?\/?/, "");
  if (route === "history" || route === "settings" || route === "queue") return route;
  if (/^history\/[^/]+$/.test(route)) return route as `history/${string}`;
  if (/^summary\/[^/]+$/.test(route)) return route as `summary/${string}`;
  return "queue";
}

export function summaryWorkspaceRoute(route: WorkspaceRoute): SummaryWorkspaceRoute | null {
  if (!route.startsWith("summary/")) return null;
  return { sessionId: route.slice("summary/".length) };
}

export function historyWorkspaceDocumentId(route: WorkspaceRoute): string | null {
  return route.startsWith("history/") ? route.slice("history/".length) : null;
}
