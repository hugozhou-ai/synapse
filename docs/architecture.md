# 架构与领域边界

## 依赖规则

- `src/domain` 是纯领域层，不依赖 Electron、Node、SQLite、JSON-RPC 或 AppleScript。
- `src/application` 只编排领域模型与 ports，不拼 SQL 或协议 DTO。
- `src/infrastructure` 实现数据库、Hook、App Server、Notes 和系统对话框适配器。
- `src/main` 是唯一 Composition Root，并负责 IPC controller 与 Electron 窗口生命周期。
- `src/renderer` 只能调用类型化 `window.synapse` preload API。

`npm run lint:architecture` 会持续检查最关键的依赖边界。

## 领域模型与服务

| 领域能力 | Interface | Class |
| --- | --- | --- |
| 会话状态规则 | `SessionLifecycleService` | `DefaultSessionLifecycleService` |
| Hook 会话感知 | `SessionAwarenessService` | `HookBasedSessionAwarenessService` |
| turn 任意选择 | `TurnSelectionService` | `ArbitraryTurnSelectionService` |
| 总结上下文 | `SummaryContextService` | `NormalizedTurnSummaryContextService` |
| 总结生成 | `SummaryGenerationService` | `DestinationAwareSummaryGenerationService` |
| 草稿/final | `SummaryFinalizationService` | `VersionedSummaryFinalizationService` |
| Notes 发布编排 | `SummaryPublicationService` | `OutboxSummaryPublicationService` |
| Hook 安装 | `HookManagementService` | `CodexHookManagementService` |
| 会话查询 | `SessionQueryService` | `RepositorySessionQueryService` |
| 总结查询 | `SummaryQueryService` | `RepositorySummaryQueryService` |
| 设置 | `SettingsApplicationService` | `PersistentSettingsApplicationService` |
| App Server 生命周期 | `AppServerRuntimeStatusProvider` | `LazyCodexAppServerRuntime` |

聚合入口：

- `CodexSessionAggregate`：`observeSession`、`startTurn`、`completeTurn`、`markSummarized`、`ignore`。
- `SummaryDocumentAggregate`：`addDraft`、`finalize`、`markPublished`、`markPublicationFailed`；版本自身记录新建或融合来源。

关键值对象：`TurnSelection`、`SummaryProfile`、`SummaryVersion`、`PublicationTarget`、`SourceRevision`。`SummaryVersion` 在运行时深冻结 content，final 不允许替换。

## Ports 与 adapters

聚合 Repository interface 定义于 `src/domain/repositories.ts`；查询、Outbox、设置和外部系统 ports 定义于 `src/application/ports.ts`。SQLite adapters 集中在 `src/infrastructure/sqlite/repositories.ts`：

- `CodexSessionRepository` → `SqliteCodexSessionRepository`
- `CodexTurnRepository` → `SqliteCodexTurnRepository`
- `HookEventRepository` → `SqliteHookEventRepository`
- `SummaryProfileRepository` → `SqliteSummaryProfileRepository`
- `SummaryDocumentRepository` → `SqliteSummaryDocumentRepository`
- `SummaryJobRepository` → `SqliteSummaryJobRepository`
- `PublicationRepository` → `SqlitePublicationRepository`
- `OutboxRepository` → `SqliteOutboxRepository`
- `SettingsRepository` → `SqliteSettingsRepository`
- `UnitOfWork` → `SqliteUnitOfWork`

外部系统：

- `CodexHookConfigStore` → `JsonCodexHookConfigStore`
- `HookRelayInstaller` → `FileSystemHookRelayInstaller`
- `HookTrustGateway` → `AppServerHookTrustGateway`
- `HookEventReceiver` → `UnixSocketHookEventReceiver`
- `HookEventSpool` → `FileSystemHookEventSpool`
- `CodexAppServerClient` → `StdioCodexAppServerClient`
- `SummaryAgentGateway` → `CodexAppServerSummaryAgentGateway`
- `SummaryPublisher` → `AppleNotesSummaryPublisher`
- `NotesTargetGateway` → `AppleNotesSummaryPublisher`
- `AppServerRuntimeStatusProvider` → `LazyCodexAppServerRuntime`
- `ExportGateway` → `ElectronExportGateway`

Hook 原始 DTO 通过 `CodexHookProtocolMapper` 转换，绝不直接进入领域或 renderer。

## 关键事务

1. Hook ingest：去重事件、完整 prompt/assistant 内容、session/turn 更新与领域 event outbox 在同一 `BEGIN IMMEDIATE` 事务中提交。Receiver 只在事务提交后返回 `OK`，Relay 未收到 ACK 必须写入离线 spool。
2. 总结生成：从已提交的本地 turns 构造上下文。新建模式携带整理方案；融合模式携带 SQLite 当前完整内容和基础版本，严禁携带整理方案。先创建 job 并提交，再调用 agent；完成后在独立事务校验基础版本并写 draft 和阶段覆盖信息。agent 调用期间不持有 SQLite 事务。
3. Finalize：不可变 final、`currentVersionId`、版本记录的 source session summarized 和 Notes outbox 同一事务提交。融合模式仅在目标存在有效 Notes external id 时自动发布。
4. Notes worker：一个 outbox 自动尝试一次。失败保留明确错误，等待用户点击重试；成功记录固定 Notes identifier 并关闭同一文档的待处理消息。
5. 删除总结：全文索引、版本、生成任务、Notes 本地发布记录和 outbox 与文档在同一事务删除；逐一检查该文档所有 final 的 source session，仅在某个 session 不再被其他 final 引用时恢复它。仓储严格区分 create/update，后台旧任务不能重新创建已删除文档。

## App Server harness

`LazyCodexAppServerRuntime` 在 Hook receiver、SQLite 和窗口启动后于后台初始化。`CodexBinaryResolver` 按显式路径、Desktop 内置 binary、登录 shell 的 `codex` 查找候选；候选通过 `initialize`/`initialized`、`model/list`、`hooks/list` 与 `account/read` 握手后才被采用。会话原文由 Hook 直接持久化，不依赖另一个 App Server 进程加载源 thread；App Server 只负责总结 agent、模型列表与 Hook 信任。

`CodexAppServerSupervisor` 只对明确的 transport error 执行单飞恢复。JSON-RPC 协议错误不会触发全局进程重启，避免中断同一进程中正在运行的总结 thread。

主进程日志同时写入控制台与权限为 `0600` 的 `~/Library/Application Support/Synapse/logs/synapse.log`。Hook 安装状态、receiver 生命周期和事件入库使用统一的 `[synapse:hook]` JSON 日志，便于区分“未安装、未信任、未收到、入库失败”四类问题。

`CodexHookManagementService` 同时维护首次 Hook 设置是否已由用户处理。启动时，`ElectronWindowManager` 只在 Hook 未安装且用户从未完成或跳过引导时自动打开设置；安装、明确跳过或主动卸载都会持久化确认状态，避免后续启动反复打扰。

Hook 安装与 Hook 信任是两个独立步骤。`HookTrustGateway` 通过 App Server `hooks/list` 获取 Codex 计算的 handler key、当前哈希和信任状态，只选择命令与 Synapse 稳定 relay 路径精确匹配的 handler。Renderer 必须先向用户展示完整命令和事件，再由 `CodexHookManagementService.trust()` 调用基础设施网关；网关通过 App Server `config/batchWrite` 原子写入 `hooks.state.<key>.trusted_hash` 并重新读取状态验证。不得静默批准、信任其他 handler，或自行计算信任哈希。

Renderer 顶层由 `RendererErrorBoundary` 隔离渲染异常，并通过类型化 diagnostics IPC 将 `window error`、未处理 Promise 和 React component stack 写入统一的 `[synapse:renderer]` 日志；页面加载失败或 Renderer 进程退出也由主进程记录，避免仅显示无诊断信息的白屏。

总结 thread 使用：

- `ephemeral: true`
- `sandbox: "read-only"`
- `approvalPolicy: "never"`
- 独立空运行目录
- 固定 base instructions 禁止工具、文件修改和网络访问
- 固定 `{title, abstract, bodyMarkdown, tags}` JSON Schema

超长会话按 turn 边界分块。每个 chunk 先生成事实摘要，再执行最终合成；`summary_jobs.stage_coverage_json` 保存每阶段覆盖的 turn IDs，不静默丢弃来源。

每个总结版本保存 `source_session_id`、`generation_mode` 和可选 `base_version_id`。因此一份总结可以累计来自多个 Codex session 的事实，同时保留逐版本来源。融合任务同时按 source session 和目标 document 排他；agent 返回后必须确认 `currentVersionId` 仍等于开始时的基础版本，否则以 `SUMMARY_TARGET_CHANGED` 失败，不追加兜底内容。

SQLite Markdown 是权威内容源，Apple Notes 仅是按固定 external id 更新的单向发布副本；Synapse 不从 Notes 回读正文。

## Renderer feature 边界

- `features/widget`：全局挂件。
- `features/queue`：进行中与待总结任务队列。
- `features/summary`：turn 选择、新建/融合目标选择、已有内容搜索预览与草稿编辑。
- `features/history`：检索、版本历史、再生成与导出。
- `features/settings`：App Server、Hook、Codex 引用插件、Notes 和整理方案；启动和状态检查均不安装插件。
- `hooks`：会话队列订阅与总结草稿状态机。
- `components`：无领域依赖的通用展示组件和 Notes 目标选择器。

Renderer 与 preload 只使用 Application contracts/ViewModels，不直接引用领域实体。

总结引用使用不可变的 document/version URI。Renderer 只把该短引用复制或拖入 prompt；随包插件不包含 skill 或 MCP server instructions，仅提供一个只读工具。工具对 SQLite 使用只读、`query_only` 连接，并要求 document/version 精确匹配；调用方可选择 metadata、abstract、outline、section 或受 `maxChars` 限制的 full，避免默认加载正文。插件安装由用户在设置页显式触发，并在保留个人 marketplace 现有内容的前提下通过 Codex CLI 完成。
