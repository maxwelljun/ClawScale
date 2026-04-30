<p align="center">
  <img src="https://clawscale.org/logo.png" alt="ClawScale" width="200" />
</p>

<h1 align="center">ClawScale</h1>
<p align="center"><strong>最简单的方式，大规模部署 IM 聊天机器人</strong></p>
<p align="center"><a href="README.md">English</a> | 中文</p>

ClawScale 是最快、最简单的方式，在 WhatsApp、Discord、Slack、Telegram 等 14+ 即时通讯平台上部署 AI 聊天机器人。连接任何 AI 后端 — OpenClaw、Claude、GPT 或你自己的模型 — 几分钟内即可上线，而非数周。多租户隔离意味着成百上千的用户可以同时聊天，互不干扰。无需样板代码，无需基础设施烦恼 — 只需填写凭据、选择 AI，点击**连接**。

## 为什么选择 ClawScale

- **几分钟内上线** — 添加频道、粘贴凭据，你的 AI 聊天机器人就已上线。无需自定义代码、Webhook 或部署管线
- **所有 IM 平台，一个面板** — WhatsApp、Discord、Slack、Telegram、Teams、LINE、Signal、微信等。在一个地方管理所有聊天机器人
- **扩展至数千用户** — 每个用户拥有完全隔离的会话、记忆和状态。无跨用户污染，无共享上下文泄漏
- **灵活组合 AI 后端** — 同时运行 OpenClaw、GPT、Claude、OpenRouter、自托管模型等。用户甚至可以在同一聊天中与多个智能体对话
- **用户引导门户** — 分享一个链接给你的用户，他们可以看到所有可用频道并即时连接 — 微信扫码、Discord OAuth、WhatsApp 发送消息。完全支持白标品牌定制
- **为团队而生** — RBAC、审计日志、访问策略和项目方案从第一天起就内置。无需后期补充安全功能
- **开源且可扩展** — MIT 许可。添加自定义适配器、更换 AI 供应商或在你自己的基础设施上自托管

## 支持的频道

| 频道 | 连接方式 |
|---|---|
| WhatsApp（个人版） | 扫描二维码 |
| WhatsApp Business | Meta Cloud API Webhook |
| Discord | Bot Token |
| Telegram | Bot Token |
| Slack | Bot Token（Socket Mode） |
| LINE | Channel Access Token（Webhook） |
| Signal | signal-cli REST API |
| Microsoft Teams | Azure Bot Service（Webhook） |
| Matrix | Homeserver URL + Access Token |
| 企业微信 | Bot Token（WebSocket） |
| 微信个人版 | 扫描二维码 |
| 网页聊天组件 | Webhook |
| Instagram | Meta API |
| Facebook | Webhook |

在面板中几秒钟内添加频道 — 填写凭据后点击**连接**即可。WhatsApp 和微信个人版会显示二维码供即时配对。无需服务器配置或 Webhook 接线。

## 支持的 AI 后端

ClawScale 不绑定任何单一 AI 供应商。自带密钥，自由组合，随时切换 — 零供应商锁定：

| 后端 | 说明 |
|---|---|
| **OpenClaw** | 一个或多个 OpenClaw 实例，拥有独立的工具、记忆和提示词 |
| **OpenAI** | 通过 OpenAI API 使用 GPT 模型 |
| **Anthropic** | 通过 Anthropic API 使用 Claude 模型 |
| **OpenRouter** | 通过一个 API Key 访问数百种模型 |
| **Pulse** | Pulse Editor AI 智能体 |
| **CLI Bridge** | 运行在本地机器上的任意 CLI 智能体（如 Claude Code）— 通过 WebSocket 隧道连接，无需公网 IP |
| **自定义** | 任何 OpenAI 兼容的端点（vLLM、Ollama、自托管模型等） |

用户可以同时激活多个后端。回复会标注来源（如 `[GPT-4o]`、`[Claude]`），方便用户了解是哪个智能体在回复。

## 快速开始

### 前置要求

- Node.js 20+
- pnpm
- Docker（用于 PostgreSQL）

### 启动步骤

```bash
# 1. 启动 Postgres
docker compose up postgres -d

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env — 默认配置适用于本地开发

# 3. 安装依赖
pnpm install

# 4. 推送数据库结构
cd packages/api && pnpm db:push && cd ../..

# 5. 启动 API 和 Web（分别在不同终端）
cd packages/api && pnpm dev
cd packages/web && pnpm dev
```

- **管理面板**: http://localhost:4040
- **API**: http://localhost:4041

或者使用 Docker 一键启动：

```bash
cp .env.example .env
docker compose up --build
```

打开面板并**注册**以创建你的项目。你将成为管理员。在这里你可以添加频道、连接 AI 后端，5 分钟内让你的第一个聊天机器人上线。

## 工作原理

```
终端用户（WhatsApp、Discord、Slack 等）
    |
    v
频道适配器 ──> POST /gateway/:channelId
    |
    v
消息路由器
    ├── 解析命令（/team、/backends 等）
    ├── 解析目标后端
    ├── 加载会话历史
    ├── 调用 AI 后端
    └── 保存消息 + 返回回复
    |
    v
频道适配器 ──> 回复终端用户
```

1. 用户在任意已连接的平台上发送消息
2. 频道适配器将消息标准化后转发给 ClawScale
3. ClawScale 将消息路由到对应的 AI 后端，保持每个用户的会话历史隔离
4. AI 的回复通过同一频道返回给用户

## 用户引导门户

ClawScale 为你的终端用户生成一个面向消费者的引导页面。分享一个链接，用户就能看到所有已连接的频道，并一键连接：

```
https://your-clawscale-instance/onboard?tenant=your-workspace
```

| 频道 | 用户连接方式 |
|---|---|
| Discord | OAuth 邀请链接 — 将机器人添加到服务器 |
| WhatsApp | 保存号码发送消息，或扫描二维码 |
| 微信 | 使用微信扫描二维码 |
| Telegram | 一键链接打开与机器人的聊天 |
| Slack | 安装链接将应用添加到工作区 |
| LINE、Signal、Teams、Matrix、网页聊天 | 平台专属的连接链接或说明 |

**白标品牌定制** — 管理员可以在面板中自定义引导门户：

- 自定义标题和副标题
- 自定义 Logo
- 品牌主题色
- 可选隐藏"Powered by ClawScale"页脚

这意味着开发者只需设置一次频道，ClawScale 就会提供一个精美的、带品牌的门户，终端用户可以直接与之交互 — 无需额外的前端开发工作。

## 附件支持

ClawScale 将用户发送的附件（图片、音频、视频、文件）直接传递给 AI 后端。支持以下所有携带媒体的频道：

| 频道 | 支持的附件类型 |
|---|---|
| WhatsApp（个人版与 Business） | 图片、音频、视频、文档 |
| Discord | 图片、文件 |
| Telegram | 图片、文档、音频、视频 |
| Slack | 文件 |
| LINE | 图片、音频、视频、文件 |
| Signal | 附件 |
| Matrix | 文件 |
| Microsoft Teams | 文件 |
| 微信个人版 & 企业微信 | 图片 |

支持视觉功能的 AI 后端（如 GPT-4o、Claude 3）将以对话的一部分接收图片附件；其他后端会收到说明附件存在的占位文本。

## CLI Bridge

在本地机器上运行任意 CLI 智能体（如 Claude Code），并将其作为后端连接到 ClawScale — 无需公网 IP 或服务器部署。

```
本地机器                               ClawScale 服务器
+-----------------+                   +------------------+
| 本地智能体       |                   |                  |
| (Claude Code)   |<-- 子进程         |   ClawScale API  |
|                 |                   |                  |
| clawscale-bridge|---WebSocket------>|   /bridge (WS)   |
|                 |   （出站连接）     |                  |
+-----------------+                   +------------------+
                                             |
                                      聊天平台
                                      (Telegram, Discord 等)
```

**快速开始：**

1. 在面板的 **AI Backends** 页面点击 **Add backend**，选择 **CLI Bridge**，复制生成的 Bridge Token。
2. 在本地机器上运行 Bridge：

```bash
npx @clawscale/cli-bridge \
  --server wss://your-clawscale-server/bridge \
  --token brg_xxxxxxxxxxxx \
  --agent claude-code
```

Bridge 建立出站 WebSocket 连接（无需开放入站端口），断线后自动进行指数退避重连。

| 选项 | 说明 |
|---|---|
| `--server` | ClawScale WebSocket URL，例如 `wss://your-server/bridge` |
| `--token` | 从面板获取的 Bridge Token |
| `--agent` | 智能体类型，目前支持 `claude-code` |

## 聊天命令

终端用户可以在聊天中直接使用命令来管理体验：

| 命令 | 功能 |
|---|---|
| `/backends` | 列出可用的 AI 后端 |
| `/team` | 显示当前激活的后端 |
| `/team invite <名称>` | 将后端添加到会话中 |
| `/team kick <名称>` | 移除后端 |
| `/clear` | 删除会话历史 |
| `/help` | 显示所有命令 |

向指定后端发送消息：`gpt> 解释量子计算`

## 多租户隔离

ClawScale 专为多用户部署设计。每个用户的会话、记忆和状态完全隔离 — 数据绝不会跨越边界。

**访问控制** — 项目管理员决定谁可以与机器人交互：

- **匿名** — 任何人都可以聊天（默认）
- **白名单** — 仅允许已批准的用户
- **黑名单** — 屏蔽特定用户

**角色** — 每个项目有三种角色：

| 角色 | 权限 |
|---|---|
| **管理员** | 完全访问 — 频道、后端、设置、成员、审计日志 |
| **成员** | 管理会话 |
| **查看者** | 只读访问 |

**方案**：入门版（5 名成员、3 个频道）、商业版（50 名成员、20 个频道）、企业版（无限制）。

## 为什么选择 ClawScale 而不是自己搭建？

大多数想要 IM 聊天机器人的团队最终都在拼凑 Webhook 处理器、消息队列、用户状态存储和 AI API 调用 — 然后为每个新平台重复一遍。ClawScale 用一个开箱即用的网关替代了所有这些，已经内置了多租户隔离、会话路由、附件转发和后端编排。

## 与 OpenClaw 的对比

ClawScale 源自 [OpenClaw](https://github.com/pulseeditor/openclaw)。OpenClaw 将消息网关和 AI 智能体捆绑在一个进程中 — 适合个人使用，但当多个用户共享同一实例时，会话之间会相互干扰。

ClawScale 将网关层与智能体层分离，使两者可以独立扩展：

| | OpenClaw | ClawScale |
|---|---|---|
| **架构** | 单体 — 网关 + 智能体在同一进程 | 解耦 — 网关层 + 可插拔的智能体后端 |
| **用户** | 单用户，共享记忆 | 多租户，每个用户独立记忆 |
| **智能体** | 一个内置智能体 | 每个租户支持多个后端 |
| **扩展性** | 单实例 | 水平扩展 — 多个智能体共用一个网关 |
| **管理功能** | 无 | 面板 + RBAC、审计日志、访问策略 |
| **部署时间** | 每个平台手动设置 | 几分钟 — 面板驱动，无需编码 |

## 技术栈

- **API** — [Hono](https://hono.dev) + [Prisma](https://prisma.io) + PostgreSQL
- **Web** — [Next.js](https://nextjs.org) 16 + React 19 + Tailwind CSS
- **AI** — OpenAI SDK、Anthropic SDK、LangChain
- **Monorepo** — pnpm workspaces

```
packages/
├── api/       # 后端、频道适配器、AI 路由、Prisma 模型
├── web/       # Next.js 管理面板
└── shared/    # 共享 TypeScript 类型
```

## 环境变量

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接字符串 |
| `JWT_SECRET` | 用于签署认证令牌的密钥 |
| `OPENAI_API_KEY` | OpenAI API 密钥（可选） |
| `CORS_ORIGIN` | 前端 URL（默认：`http://localhost:4040`） |
| `PORT` | API 端口（默认：`4041`） |
| `WHATSAPP_AUTH_DIR` | WhatsApp 会话文件目录（默认：`./data/whatsapp`） |
| `OPENCLAW_IMAGE` | 隔离 OpenClaw runtime 使用的 Docker 镜像（默认：`1panel/openclaw:latest`） |
| `OPENCLAW_DOCKER_ISOLATION` | 设为 `false` 时关闭每用户 Docker runtime，直接使用 backend `baseUrl` |
| `OPENCLAW_DATA_DIR` | 隔离 OpenClaw state/workspace 数据根目录（默认：`./data/tenants`） |
| `OPENCLAW_GATEWAY_TOKEN` | 传给隔离 OpenClaw gateway 容器的可选 token |
| `OPENCLAW_DOCKER_NETWORK` | app 到 OpenClaw 容器通信使用的可选 Docker 网络 |
| `OPENCLAW_MODEL_PROVIDER_ID` | 可选的默认 OpenClaw 模型 provider id，例如 `minimax` |
| `OPENCLAW_MODEL_PROVIDER_BASE_URL` | 可选的默认 OpenClaw 模型 provider base URL |
| `OPENCLAW_MODEL_PROVIDER_API_KEY` | 可选的默认 OpenClaw 模型 provider API key |
| `OPENCLAW_MODEL_PROVIDER_API` | OpenClaw provider API 类型（默认：`openai-completions`） |
| `OPENCLAW_DEFAULT_MODEL` | 可选的默认 OpenClaw 模型 id |
| `OPENCLAW_READY_TIMEOUT_MS` | 等待隔离 OpenClaw gateway 就绪的时长（默认：`180000`） |
| `OPENCLAW_CHAT_TIMEOUT_MS` | 等待 OpenClaw chat completion 的时长（默认：`600000`） |
| `OPENCLAW_MAX_COMPLETION_TOKENS` | 发送给 OpenClaw OpenAI-compatible chat completions 的最大输出 token（默认：`512`） |
| `OPENCLAW_PREWARM_CHAT` | 设为 `true` 时使用 chat completion 预热。默认仅预热 `/v1/models`，避免与真实用户消息竞争 |
| `OPENCLAW_SHARED_RUNTIME_DEPS` | 在隔离 runtime 之间共享 OpenClaw 插件依赖缓存，同时保持 state/workspace 隔离（默认：`true`） |
| `OPENCLAW_STREAM` | 在 OpenClaw 支持时使用 OpenAI-compatible 流式 chat 调用（默认：`true`） |

## 运维脚本

脚本位于 `scripts/`，默认部署目标为 `ubuntu@43.128.225.9:/root/ClawScale`，默认分支为 `dev`。密码不写入仓库；如果使用密码登录，请在执行前设置 `SSHPASS`。

```bash
export SSHPASS='your-ssh-password'
```

| 脚本 | 用途 |
|---|---|
| `scripts/push-dev.sh` | 使用 `gh` token 通过 GitHub HTTPS 推送当前 `dev` 分支 |
| `scripts/remote-clean-containers.sh` | 停止 compose 服务并删除带 `clawscale.openclaw=true` label 的 OpenClaw runtime 容器 |
| `scripts/remote-clean-data.sh` | 完整清理：停止服务、删除 Postgres volume、删除 OpenClaw runtime 容器和 `data/openclaw` |
| `scripts/remote-deploy.sh` | 服务器拉取 `origin/dev`，重置到最新代码并 `docker compose up -d --build` |
| `scripts/remote-status.sh` | 查看 compose 状态、app 日志、核心表计数和 OpenClaw runtime 容器 |
| `scripts/push-clean-redeploy.sh` | 聚合脚本：推送、清理数据、重新部署、检查状态 |

可覆盖目标环境：

```bash
DEPLOY_HOST=43.128.225.9 \
DEPLOY_USER=ubuntu \
DEPLOY_DIR=/root/ClawScale \
DEPLOY_BRANCH=dev \
SSHPASS='your-ssh-password' \
scripts/push-clean-redeploy.sh
```

## 许可证

MIT
