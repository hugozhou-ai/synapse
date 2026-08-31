export type WorkspaceRoute = "history" | "queue" | "settings" | `summary/${string}`;

export function parseWorkspaceRoute(value: string): WorkspaceRoute {
  const route = value.replace(/^#?\/?/, "");
  if (route === "history" || route === "settings" || route === "queue") return route;
  if (route.startsWith("summary/") && route.length > "summary/".length) return route as `summary/${string}`;
  return "queue";
}
