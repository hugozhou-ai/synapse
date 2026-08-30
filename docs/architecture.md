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
| 总结生成 | `SummaryGenerationService` | `ProfileDrivenSummaryGenerationService` |
| 草稿/final | `SummaryFinalizationService` | `VersionedSummaryFinalizationService` |
| Notes 发布编排 | `SummaryPublicationService` | `OutboxSummaryPublicationService` |
| Hook 安装 | `HookManagementService` | `CodexHookManagementService` |
| 会话查询 | `SessionQueryService` | `RepositorySessionQueryService` |
| 总结查询 | `SummaryQueryService` | `RepositorySummaryQueryService` |
| 设置 | `SettingsApplicationService` | `PersistentSettingsApplicationService` |

聚合入口：

- `CodexSessionAggregate`：`observeSession`、`startTurn`、`completeTurn`、`markSummarized`、`ignore`。
- `SummaryDocumentAggregate`：`addDraft`、`finalize`、`markPublished`、`markPublicationFailed`。

关键值对象：`TurnSelection`、`SummaryProfile`、`SummaryVersion`、`PublicationTarget`、`SourceRevision`。`SummaryVersion` 在运行时深冻结 content，final 不允许替换。

## Ports 与 adapters

Repository ports 全部定义于 `src/application/ports.ts`，SQLite adapters 集中在 `src/infrastructure/sqlite/repositories.ts`：

- `CodexSessionRepository` → `SqliteCodexSessionRepository`
- `CodexTurnRepository` → `SqliteCodexTurnRepository`
- `HookEventRepository` → `SqliteHookEventRepository`
- `SummaryProfileRepository` → `SqliteSummaryProfileRepository`
- `SummaryDocumentRepository` → `SqliteSummaryDocumentRepository`
- `SummaryJobRepository` → `SqliteSummaryJobRepository`
- `PublicationRepository` → `SqlitePublicationRepository`
- `OutboxRepository` → `SqliteOutboxRepository`
- `SettingsRepository` → `SqliteSettingsRepository`
- `UnitOfWork` → `BetterSqliteUnitOfWork`

外部系统：

- `CodexHookConfigStore` → `JsonCodexHookConfigStore`
- `HookRelayInstaller` → `FileSystemHookRelayInstaller`
- `HookTrustGateway` → `AppServerHookTrustGateway`
- `HookEventReceiver` → `UnixSocketHookEventReceiver`
- `HookEventSpool` → `FileSystemHookEventSpool`
- `CodexAppServerClient` → `StdioCodexAppServerClient`
- `ConversationGateway` → `AppServerConversationGateway`
- `SummaryAgentGateway` → `CodexAppServerSummaryAgentGateway`
- `SummaryPublisher` → `AppleNotesSummaryPublisher`
- `ExportGateway` → `ElectronExportGateway`

Hook 与 App Server 原始 DTO 分别通过 `CodexHookProtocolMapper`、`CodexProtocolMapper` 转换，绝不直接进入领域或 renderer。

## 关键事务

1. Hook ingest：去重事件、session/turn 更新、领域 event outbox 在同一 `BEGIN IMMEDIATE` 事务中提交。
2. 总结生成：先创建 job 并提交，再调用 agent；完成后在独立事务写 draft 和阶段覆盖信息。agent 调用期间不持有 SQLite 事务。
3. Finalize：不可变 final、`currentVersionId`、session summarized 和 Notes outbox 同一事务提交。
4. Notes worker：一个 outbox 自动尝试一次。失败保留明确错误，等待用户点击重试；成功记录固定 Notes identifier 并关闭同一文档的待处理消息。

## App Server harness

`CodexBinaryResolver` 按显式路径、Desktop 内置 binary、登录 shell 的 `codex` 查找候选。候选通过 `initialize`/`initialized`、`model/list`、`hooks/list` 与 `account/read` 握手后才被采用。

总结 thread 使用：

- `ephemeral: true`
- `sandbox: "read-only"`
- `approvalPolicy: "never"`
- 独立空运行目录
- 固定 base instructions 禁止工具、文件修改和网络访问
- 固定 `{title, abstract, bodyMarkdown, tags}` JSON Schema

超长会话按 turn 边界分块。每个 chunk 先生成事实摘要，再执行最终合成；`summary_jobs.stage_coverage_json` 保存每阶段覆盖的 turn IDs，不静默丢弃来源。
