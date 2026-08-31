export type RendererSurface = "widget" | "workspace";

export function resolveRendererSurface(hash: string): RendererSurface {
  return hash.startsWith("#/widget") ? "widget" : "workspace";
}
