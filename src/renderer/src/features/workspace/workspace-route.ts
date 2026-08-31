export type WorkspaceRoute = "history" | "queue" | "settings" | `summary/${string}`;

export interface SummaryWorkspaceRoute {
  readonly sessionId: string;
  readonly autoGenerate: boolean;
}

export function parseWorkspaceRoute(value: string): WorkspaceRoute {
  const route = value.replace(/^#?\/?/, "");
  if (route === "history" || route === "settings" || route === "queue") return route;
  if (/^summary\/(?:quick\/)?[^/]+$/.test(route)) return route as `summary/${string}`;
  return "queue";
}

export function summaryWorkspaceRoute(route: WorkspaceRoute): SummaryWorkspaceRoute | null {
  if (!route.startsWith("summary/")) return null;
  const autoGenerate = route.startsWith("summary/quick/");
  return { sessionId: route.slice(autoGenerate ? "summary/quick/".length : "summary/".length), autoGenerate };
}
