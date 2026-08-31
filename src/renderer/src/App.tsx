import { Widget } from "./features/widget/Widget";
import { Workspace } from "./features/workspace/Workspace";
import { resolveRendererSurface } from "./lib/renderer-surface";

export function App() {
  return resolveRendererSurface(location.hash) === "widget" ? <Widget /> : <Workspace />;
}
