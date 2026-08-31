import { ShieldCheck, X } from "lucide-react";
import type { HookTrustCandidate } from "@application/ports";

interface HookTrustDialogProps {
  readonly hooks: readonly HookTrustCandidate[];
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function HookTrustDialog({ hooks, busy, onCancel, onConfirm }: HookTrustDialogProps) {
  const commands = [...new Set(hooks.map((hook) => hook.command))];
  return <div className="modal-backdrop" role="presentation">
    <div className="profile-modal hook-trust-dialog" role="dialog" aria-modal="true" aria-labelledby="hook-trust-title">
      <div className="panel-head">
        <div><span className="eyebrow">SECURITY REVIEW</span><h2 id="hook-trust-title">信任 Synapse Hook</h2></div>
        <button className="icon-button" aria-label="关闭" disabled={busy} onClick={onCancel}><X size={17} /></button>
      </div>
      <p>Codex 默认不会执行新安装或内容已变化的 Hook。确认后，Synapse 只会批准下列当前命令及其内容哈希；文件一旦变化，Codex 会自动恢复为待信任状态。</p>
      <div className="trust-command-review">
        {commands.map((command) => <code key={command}>{command}</code>)}
      </div>
      <div className="trust-event-review">
        {hooks.map((hook) => <span key={`${hook.key}:${hook.currentHash}`}><strong>{eventLabel(hook.eventName)}</strong><em>{hook.status === "modified" ? "内容已变化" : "待信任"}</em></span>)}
      </div>
      <p className="trust-footnote">信任记录由 Codex 保存到用户配置，仅适用于上面列出的精确 Hook 哈希。</p>
      <div className="modal-actions">
        <button className="ghost" disabled={busy} onClick={onCancel}>取消</button>
        <button className="primary" disabled={busy} onClick={onConfirm}><ShieldCheck size={14} />{busy ? "正在确认…" : `信任并启用（${hooks.length}）`}</button>
      </div>
    </div>
  </div>;
}

function eventLabel(eventName: string): string {
  const labels: Record<string, string> = {
    sessionStart: "任务开始",
    userPromptSubmit: "提交提示词",
    stop: "任务结束",
  };
  return labels[eventName] ?? eventName;
}
