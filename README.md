# dsh-super-agent

`dsh-super-agent` 是 DeepSeek Harness 的场景化 Agent preset 包。一个发布入口提供四个可独立选择的 preset：`solo`、`team`、`research` 和 `optimization`。安装包不会把四个场景合并成一个默认的“大而全” Agent；部署者或用户在创建 session 时选择需要的场景。

## 安装和装配

这是一个包含 preset 配置和一个最小 bundle patch 的包，依赖 DeepSeek Harness 官方插件。推荐直接安装到 profile：

```bash
dsh plugin --profile my-profile add @super-agent/dsh-super-agent
```

安装后，包的 `cordis.patch.yml` 会自动把自己的 `presets/` 目录加入 `dsh-agent-presets` 的 system roots，并将默认 preset 设为 `solo`。启动 profile 后可以在 session 创建时选择 `team`、`research` 或 `optimization`。

如果部署不使用 bundle 自动装配，也可以手工在宿主 composition 中启用 `@deepseek-ai/dsh-agent-presets`，并把本包的 `presets` 目录加入 roots：

```yaml
- name: '@deepseek-ai/dsh-agent-presets'
  config:
    default: solo
    roots:
      - path: ./node_modules/@super-agent/dsh-super-agent/presets
        trust: system
```

`path` 必须改成部署环境中实际的绝对路径或工作目录相对路径。bundle 安装路径由 DSH profile 的 pnpm 管理，不要把 `node_modules` 路径硬编码进提交文件。也可以关闭 `includeShippedRoot`，只保留自己的 preset；root 按顺序扫描，重复 id 由先出现的 root 获胜。

安装本包不会自动修改宿主 composition、启用网络、授予 shell 权限或配置模型账号。宿主仍负责 sandbox、审批、持久化、模型路由和各类 registry。

## 四个 preset

| preset | 用途 | 主要能力 |
| --- | --- | --- |
| `solo` | 单 Agent 交付 | 文件读写、shell、goal、Skill 目录 |
| `team` | 负责人式协作 | `dsh-subagent` 委派、`dsh-jobs` 后台任务、任务树/负责人/验收提示词 |
| `research` | 可复核调研 | Web 搜索/抓取工具、来源和反例核验、证据报告提示词 |
| `optimization` | 性能和系统实验 | goal、todo、jobs、plan mode、基线/指标/回滚/停止条件提示词 |

`team` 的 `spawn` provider 需要宿主已装配对应的 in-process subagent provider。`research` 的 web 工具需要宿主同时装配 `@deepseek-ai/dsh-web` 和至少一个搜索或抓取 backend；本包只声明模型看到的工具。缺少宿主服务时，Harness 会在挂载或调用阶段报告依赖错误，不会由 preset 绕过权限。

每个 preset 旁边的 `preset.yml` 只用于选择器显示名称、说明和排序；真正的能力声明在 `agent.cordis.yml` 中。预设是 session 级组合：同一进程可以同时运行不同 preset，session 状态仍然彼此隔离。

## 为什么是一个发布入口、多个 preset

发布入口是一个 npm 包和一个 roots 路径，便于版本、兼容性和审计统一管理。多个 preset 是包内的四个目录，用户按任务选择其中一个，子 Agent 继承父 Agent 的 preset。这样可以共享发布和升级流程，同时避免每个场景都维护一套安装脚本，也避免默认加载全部工具造成权限和提示词膨胀。

这个设计不会把 Super Agent 的完整企业任务系统塞进 preset。当前任务树、负责人、提交/评审/返工/验收/交付等规则以场景提示词表达，委派和后台执行复用 Harness 官方 `dsh-subagent`、`dsh-jobs`、`dsh-goal`。如果未来需要跨 session 的组织数据库、审计事件或强制验收，应另做 host-plane 服务插件，并由 preset 通过稳定协议消费；不要在每个 `agent.cordis.yml` 里复制第二套 runtime。

## 兼容性和权限边界

- 目标 Harness 版本：`0.1.2-alpha.1`（与当前 pinned Harness 对齐）。
- 本包只包含声明式 YAML、显示元数据和文档，不执行安装脚本。
- preset 的实际权限等于它列出的官方工具以及宿主为这些工具提供的服务；`trust: system` 只表示部署信任来源，不是额外沙箱。
- `tool-bash`/`tool-pwsh`、文件工具和 web 工具仍受宿主 sandbox、审批和网络策略约束。
- 修改 `agent.cordis.yml` 会影响新挂载的 preset generation；正在运行的 session 保持原组合。修改旁边的 Skill 或资源文件后，按 Harness 的 generation 规则重启或触发 composition 文件变更。

## 目录

```text
presets/
├── solo/agent.cordis.yml
├── team/agent.cordis.yml
├── research/agent.cordis.yml
└── optimization/agent.cordis.yml
```

