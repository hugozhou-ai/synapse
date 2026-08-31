export function resolveRendererUrl(baseUrl: string, route: string): string {
  const url = new URL(baseUrl);
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  url.hash = `/${route}`;
  return url.toString();
}
