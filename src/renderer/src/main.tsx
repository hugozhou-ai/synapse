import "@fontsource-variable/inter";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { RendererErrorBoundary } from "./components/RendererErrorBoundary";
import "./styles.css";

window.addEventListener("error", (event) => {
  void window.synapse.diagnostics.reportRendererError({
    kind: "window-error", message: event.message, stack: event.error instanceof Error ? event.error.stack ?? null : null, componentStack: null,
  }).catch((reason) => console.error(`[synapse:renderer] ${JSON.stringify({ message: "error-report-failed", reason: reason instanceof Error ? reason.message : String(reason) })}`));
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  void window.synapse.diagnostics.reportRendererError({
    kind: "unhandled-rejection", message: reason instanceof Error ? reason.message : String(reason), stack: reason instanceof Error ? reason.stack ?? null : null, componentStack: null,
  }).catch((reportError) => console.error(`[synapse:renderer] ${JSON.stringify({ message: "error-report-failed", reason: reportError instanceof Error ? reportError.message : String(reportError) })}`));
});

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><RendererErrorBoundary><App /></RendererErrorBoundary></React.StrictMode>);
