import { useCallback, useEffect, useState } from "react";
import { BookOpen, Code2, NotebookPen, PackageCheck, Plus, ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
import type { AgentModel, ApplicationSettings, AppServerRuntimeStatus, CodexPluginInstallationStatus, HookInstallationStatus } from "@application/ports";
import type { NotesTargetsView, NotionConnectionView, SummaryProfileView } from "@application/contracts";
import { ErrorBanner, InfoBanner, PageHeader } from "../../components/common";
import { NotesTargetPicker } from "../../components/NotesTargetPicker";
import { Select } from "../../components/Select";
import { messageOf, shortPath } from "../../lib/format";
import { HookTrustDialog } from "./HookTrustDialog";

export function SettingsPage() {
  const [settings, setSettings] = useState<ApplicationSettings | null>(null);
  const [hooks, setHooks] = useState<HookInstallationStatus | null>(null);
  const [plugin, setPlugin] = useState<CodexPluginInstallationStatus | null>(null);
  const [profiles, setProfiles] = useState<readonly SummaryProfileView[]>([]);
  const [models, setModels] = useState<readonly AgentModel[]>([]);
  const [notesTargets, setNotesTargets] = useState<NotesTargetsView | null>(null);
  const [notionConnection, setNotionConnection] = useState<NotionConnectionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [runtime, setRuntime] = useState<AppServerRuntimeStatus | null>(null);
  const [editing, setEditing] = useState<SummaryProfileView | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [reviewingHookTrust, setReviewingHookTrust] = useState(false);

  const reload = useCallback(() => {
    void Promise.all([window.synapse.settings.read(), window.synapse.settings.runtime(), window.synapse.hooks.inspect(), window.synapse.plugin.inspect(), window.synapse.profiles.list()])
      .then(([nextSettings, nextRuntime, nextHooks, nextPlugin, nextProfiles]) => { setSettings(nextSettings); setRuntime(nextRuntime); setHooks(nextHooks); setPlugin(nextPlugin); setProfiles(nextProfiles); })
      .catch((reason) => setError(messageOf(reason)));
    void window.synapse.settings.models().then(setModels).catch((reason) => setError(messageOf(reason)));
    void window.synapse.settings.notesTargets().then((value) => { setNotesTargets(value); setNotesError(null); }).catch((reason) => setNotesError(messageOf(reason)));
    void window.synapse.settings.notionConnection().then(setNotionConnection).catch((reason) => setNotionConnection({ available: false, connected: false, message: messageOf(reason) }));
  }, []);
  useEffect(reload, [reload]);
  useEffect(() => {
    if (runtime?.state !== "initializing") return;
    const timer = window.setInterval(() => void window.synapse.settings.runtime().then(setRuntime), 1_000);
    return () => window.clearInterval(timer);
  }, [runtime?.state]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      setSettings(await window.synapse.settings.update({
        codexBinaryPath: settings.codexBinaryPath, summaryModel: settings.summaryModel,
        defaultPublicationKind: settings.defaultPublicationKind, notesAccount: settings.notesAccount, notesFolder: settings.notesFolder,
        notionParentPageId: settings.notionParentPageId,
        widgetVisible: settings.widgetVisible, widgetPositions: settings.widgetPositions, widgetDisplayId: settings.widgetDisplayId,
      }));
    } catch (reason) { setError(messageOf(reason)); } finally { setSaving(false); }
  };
  const hookAction = async (install: boolean) => { setSaving(true); setError(null); try { const next = install ? await window.synapse.hooks.install() : await window.synapse.hooks.uninstall(); setHooks(next); setReviewingHookTrust(install && pendingTrustHooks(next).length > 0); } catch (reason) { setError(messageOf(reason)); } finally { setSaving(false); } };
  const trustHooks = async () => { setSaving(true); setError(null); try { const next = await window.synapse.hooks.trust(); setHooks(next); if (next.trusted) setReviewingHookTrust(false); } catch (reason) { setError(messageOf(reason)); } finally { setSaving(false); } };
  const dismissHookOnboarding = async () => { setSaving(true); setError(null); try { setHooks(await window.synapse.hooks.dismissOnboarding()); } catch (reason) { setError(messageOf(reason)); } finally { setSaving(false); } };
  const installPlugin = async () => { setSaving(true); setError(null); try { setPlugin(await window.synapse.plugin.install()); } catch (reason) { setError(messageOf(reason)); } finally { setSaving(false); } };
  const saveProfile = async () => { if (!editing) return; try { await window.synapse.profiles.save(editing); setEditing(null); setConfirmingDelete(false); reload(); } catch (reason) { setError(messageOf(reason)); } };
  const deleteProfile = async () => {
    if (!editing?.id || editing.id === "builtin-task-retrospective") return;
    if (!confirmingDelete) { setConfirmingDelete(true); return; }
    try { await window.synapse.profiles.delete(editing.id); setEditing(null); setConfirmingDelete(false); reload(); } catch (reason) { setError(messageOf(reason)); }
  };
  const runtimeLabel = runtime?.state === "initializing" ? "连接中" : runtime?.available ? "已连接" : "不可用";
  const pendingHooks = hooks ? pendingTrustHooks(hooks) : [];

  return <div className="page settings-page">
    <PageHeader eyebrow="CONFIGURATION" title="设置" description="外部系统均通过基础设施适配器连接；修改 Codex binary 后请重启 Synapse 以重新握手。" actions={<button className="primary" disabled={saving} onClick={save}>保存设置</button>} />
    {error && <ErrorBanner message={error} />}
    {hooks?.onboardingRequired && <section className="hook-onboarding" aria-labelledby="hook-onboarding-title"><div><span className="eyebrow">FIRST-TIME SETUP</span><h2 id="hook-onboarding-title">连接 Codex，开始感知任务</h2><p>Synapse 需要安装三个低噪声 Hook 才能收到任务开始、prompt 提交和结束事件。安装会保留你现有的 Hook 配置并创建备份。</p></div><div className="onboarding-actions"><button className="ghost" disabled={saving} onClick={dismissHookOnboarding}>暂不设置</button><button className="primary" disabled={saving} onClick={() => hookAction(true)}><Plus size={14} />安装 Hook</button></div></section>}
    <section className="settings-section"><div className="settings-title"><div className="setting-icon"><Code2 size={18} /></div><div><h2>Codex App Server</h2><p>用于按需运行总结 agent，以及读取模型与 Hook 状态。</p></div><span className={`health ${runtime?.available ? "good" : "warn"}`}>{runtimeLabel}</span></div><div className="runtime-grid"><span><small>实际 binary</small><code>{runtime?.binaryPath ?? "—"}</code></span><span><small>版本</small><code>{runtime?.version ?? "—"}</code></span><span><small>认证</small><code>{runtime?.authentication ?? "unknown"}</code></span></div>{runtime?.error && <ErrorBanner message={runtime.error} />}<div className="settings-fields"><label>Codex binary 路径<input value={settings?.codexBinaryPath ?? ""} placeholder="自动发现" onChange={(event) => settings && setSettings({ ...settings, codexBinaryPath: event.target.value || null })} /></label><label>总结模型<Select ariaLabel="总结模型" value={settings?.summaryModel ?? ""} disabled={runtime?.state === "initializing"} onChange={(summaryModel) => settings && setSettings({ ...settings, summaryModel: summaryModel || null })} options={[{ value: "", label: "使用 Codex 默认模型" }, ...(settings?.summaryModel && !models.some((model) => model.id === settings.summaryModel) ? [{ value: settings.summaryModel, label: settings.summaryModel }] : []), ...models.map((model) => ({ value: model.id, label: `${model.displayName}${model.isDefault ? "（默认）" : ""}` }))]} /></label></div></section>
    <section className="settings-section">
      <div className="settings-title"><div className="setting-icon accent"><Sparkles size={18} /></div><div><h2>Codex Hook</h2><p>SessionStart、UserPromptSubmit 与 Stop；安装操作会备份并原子合并现有配置。</p></div>{hooks && <span className={`health ${hooks.trusted ? "good" : "warn"}`}>{hooks.trusted ? "已启用" : hooks.installed ? "待信任" : "未安装"}</span>}</div>
      {hooks ? <>
        <div className="hook-paths"><code>{hooks.relayPath}</code><code>{hooks.configPath}</code><code>运行日志：~/Library/Application Support/Synapse/logs/synapse.log</code></div>
        {hooks.message && (hooks.installed ? <InfoBanner message={hooks.message} /> : <ErrorBanner message={hooks.message} />)}
        {hooks.trustStates.length > 0 && <div className="trust-list">{hooks.trustStates.map((state) => <span key={state.cwd}><code>{shortPath(state.cwd)}</code><em className={state.status}>{state.status}</em></span>)}</div>}
        <div className="row-actions">{pendingHooks.length > 0 && <button className="primary" disabled={saving} onClick={() => setReviewingHookTrust(true)}><ShieldCheck size={14} />检查并信任</button>}{hooks.installed ? <button className="danger" disabled={saving} onClick={() => hookAction(false)}><Trash2 size={14} />卸载自有 Hook</button> : <button className="primary" disabled={saving} onClick={() => hookAction(true)}><Plus size={14} />{hooks.message?.includes("安装不完整") ? "修复安装" : "安装 Hook"}</button>}</div>
      </> : <div className="hook-status-loading" role="status">正在检测 Hook 状态…</div>}
    </section>
    <section className="settings-section">
      <div className="settings-title"><div className="setting-icon"><PackageCheck size={18} /></div><div><h2>Codex 引用插件</h2><p>仅在你粘贴 Synapse 引用后按需读取；不会默认注入总结正文。</p></div>{plugin && <span className={`health ${plugin.current ? "good" : "warn"}`}>{plugin.current ? "已安装" : plugin.installed ? "可更新" : "未安装"}</span>}</div>
      {plugin ? <><div className="hook-paths"><code>{plugin.pluginPath}</code><code>{plugin.marketplacePath}</code><code>随包版本：{plugin.bundledVersion}{plugin.installedVersion ? ` · 已安装：${plugin.installedVersion}` : ""}</code></div>{plugin.message && (plugin.current ? <InfoBanner message={plugin.message} /> : <ErrorBanner message={plugin.message} />)}<div className="row-actions"><button className="primary" disabled={saving || plugin.current} onClick={installPlugin}><Plus size={14} />{plugin.installed ? "更新引用插件" : "安装引用插件"}</button></div></> : <div className="hook-status-loading" role="status">正在检测引用插件…</div>}
    </section>
    <section className="settings-section"><div className="settings-title"><div className="setting-icon"><NotebookPen size={18} /></div><div><h2>外部发布</h2><p>仅在 final 版本提交后执行，同一文档持续更新同一外部页面。</p></div></div>{settings && <label>默认发布目标<Select ariaLabel="默认发布目标" value={settings.defaultPublicationKind ?? ""} onChange={(value) => setSettings({ ...settings, defaultPublicationKind: value ? value as "apple-notes" | "notion" : null })} options={[{ value: "", label: "仅保存到 SQLite" }, { value: "apple-notes", label: "Apple Notes" }, { value: "notion", label: "Notion" }]} /></label>}{notesError && <ErrorBanner message={`无法读取 Notes 目标：${notesError}`} />}{settings && <><h3>Apple Notes</h3><NotesTargetPicker targets={notesTargets} account={settings.notesAccount ?? ""} folder={settings.notesFolder} onAccountChange={(value) => setSettings({ ...settings, notesAccount: value || null })} onFolderChange={(value) => setSettings({ ...settings, notesFolder: value })} /><h3>Notion</h3><span className={`health ${notionConnection?.connected ? "good" : "warn"}`}>{notionConnection?.connected ? "已连接" : "不可用"}</span>{notionConnection?.message && <ErrorBanner message={notionConnection.message} />}<label>父页面 URL 或 ID<input value={settings.notionParentPageId} placeholder="https://www.notion.so/..." onChange={(event) => setSettings({ ...settings, notionParentPageId: event.target.value })} /><small>Synapse 会通过 Codex App Server 调用已连接的 Notion MCP，在该页面下创建总结。</small></label></>}</section>
    <section className="settings-section"><div className="settings-title"><div className="setting-icon"><BookOpen size={18} /></div><div><h2>整理方案</h2><p>模板型保持 Markdown 骨架，系统提示词型提供完整规则。</p></div><button className="secondary push" onClick={() => { setConfirmingDelete(false); setEditing({ id: "", name: "", kind: "template", instructions: "", isDefault: false }); }}><Plus size={14} />新建</button></div><div className="profile-list">{profiles.map((profile) => <button key={profile.id} onClick={() => { setConfirmingDelete(false); setEditing(profile); }}><div><strong>{profile.name}</strong><span>{profile.kind === "template" ? "Markdown 模板" : "系统提示词"}</span></div>{profile.isDefault && <em>默认</em>}</button>)}</div></section>
    {editing && <div className="modal-backdrop" role="presentation"><div className="profile-modal" role="dialog" aria-modal="true" aria-label={editing.id ? "编辑整理方案" : "新建整理方案"}><div className="panel-head"><h2>{editing.id ? "编辑整理方案" : "新建整理方案"}</h2><button className="icon-button" aria-label="关闭" onClick={() => { setEditing(null); setConfirmingDelete(false); }}><X size={17} /></button></div><label>名称<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label><label>类型<Select ariaLabel="类型" value={editing.kind} onChange={(kind) => setEditing({ ...editing, kind: kind as SummaryProfileView["kind"] })} options={[{ value: "template", label: "Markdown 模板" }, { value: "systemPrompt", label: "系统提示词" }]} /></label><label>内容<textarea className="profile-editor" value={editing.instructions} onChange={(event) => setEditing({ ...editing, instructions: event.target.value })} /></label><label className="check-line"><input type="checkbox" checked={editing.isDefault} onChange={(event) => setEditing({ ...editing, isDefault: event.target.checked })} />设为默认</label>{confirmingDelete && <ErrorBanner message={`再次点击“确认删除”将永久删除方案“${editing.name}”。`} />}<div className="modal-actions">{editing.id && editing.id !== "builtin-task-retrospective" && <button className="danger" onClick={deleteProfile}><Trash2 size={14} />{confirmingDelete ? "确认删除" : "删除"}</button>}<button className="primary" onClick={saveProfile}>保存方案</button></div></div></div>}
    {reviewingHookTrust && pendingHooks.length > 0 && <HookTrustDialog hooks={pendingHooks} busy={saving} onCancel={() => setReviewingHookTrust(false)} onConfirm={trustHooks} />}
  </div>;
}

function pendingTrustHooks(status: HookInstallationStatus) {
  return [...new Map(status.trustStates.flatMap((state) => state.hooks).filter((hook) => hook.status === "untrusted" || hook.status === "modified").map((hook) => [`${hook.key}:${hook.currentHash}`, hook])).values()];
}
