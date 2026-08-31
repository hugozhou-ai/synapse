import { Component, type ErrorInfo, type ReactNode } from "react";
import { CircleAlert, RotateCcw } from "lucide-react";

interface State { readonly error: Error | null; }

export class RendererErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    void window.synapse.diagnostics.reportRendererError({
      kind: "react-error", message: error.message, stack: error.stack ?? null, componentStack: info.componentStack ?? null,
    }).catch((reason) => console.error(`[synapse:renderer] ${JSON.stringify({ message: "error-report-failed", reason: reason instanceof Error ? reason.message : String(reason) })}`));
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return <main className="renderer-error"><CircleAlert size={28} /><h1>页面加载失败</h1><p>{this.state.error.message}</p><button className="primary" onClick={() => location.reload()}><RotateCcw size={15} />重新加载</button></main>;
  }
}
