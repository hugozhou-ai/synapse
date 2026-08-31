import { Widget } from "./features/widget/Widget";
import { Workspace } from "./features/workspace/Workspace";

export function App() {
  return location.hash.startsWith("#/widget") ? <Widget /> : <Workspace />;
}
