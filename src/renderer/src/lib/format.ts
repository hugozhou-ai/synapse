export function statusLabel(status: string): string {
  return ({ observed: "已观察", running: "进行中", ready: "待总结", summarized: "已总结", ignored: "已忽略", completed: "已完成", failed: "失败", interrupted: "已中断" } as Record<string, string>)[status] ?? status;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
}

export function shortPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : path || "未知目录";
}

export function messageOf(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
