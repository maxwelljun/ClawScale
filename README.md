<p align="center">
  <img src="https://clawscale.org/logo.png" alt="ClawScale" width="200" />
</p>

<h1 align="center">ClawScale</h1>
<p align="center"><strong>The easiest way to deploy AI chatbots to every messaging platform — at scale</strong></p>
<p align="center">English | <a href="README.zh-CN.md">中文</a></p>

ClawScale is the fastest, simplest way to set up AI-powered chatbots across WhatsApp, Discord, Slack, Telegram, and 14+ instant messaging platforms. Connect any AI backend — OpenClaw, Claude, GPT, or your own models — and go live in minutes, not weeks. Multi-tenant isolation means hundreds or thousands of users can chat simultaneously without interfering with each other. No boilerplate, no infrastructure headaches — just plug in your credentials, pick your AI, and hit **Connect**.

## Why teams choose ClawScale

- **Go live in minutes** — add a channel, paste your credentials, and your AI chatbot is live. No custom code, webhooks, or deployment pipelines to wire up
- **Every IM platform, one dashboard** — WhatsApp, Discord, Slack, Telegram, Teams, LINE, Signal, WeChat, and more. Manage all your chatbots from a single place
- **Scale to thousands of users** — each user gets fully isolated conversations, memory, and state. No cross-contamination, no shared context leaking between users
- **Mix and match AI backends** — run OpenClaw, GPT, Claude, OpenRouter, self-hosted models, or all of them at once. Users can even talk to multiple agents in the same chat
- **Consumer onboarding portal** — share a single link with your users. They see every available channel and can connect instantly — scan a QR for WeChat, add the bot on Discord via OAuth, message a number on WhatsApp. Fully white-label with custom branding
- **Built for teams** — RBAC, audit logs, access policies, and project plans from day one. No bolting on security later
- **Open source and extensible** — MIT licensed. Add custom adapters, swap AI providers, or self-host on your own infrastructure

## Supported channels

| Channel | Connection method |
|---|---|
| WhatsApp (Personal) | QR code scan |
| WhatsApp Business | Meta Cloud API webhook |
| Discord | Bot token |
| Telegram | Bot token |
| Slack | Bot token (Socket Mode) |
| LINE | Channel access token (webhook) |
| Signal | signal-cli REST API |
| Microsoft Teams | Azure Bot Service (webhook) |
| Matrix | Homeserver URL + access token |
| WeChat Work (WeCom) | Bot token (WebSocket) |
| WeChat Personal | QR code scan |
| Web Chat Widget | Webhook |
| Instagram | Meta API |
| Facebook | Webhook |

Add channels from the dashboard in seconds — provide credentials and hit **Connect**. WhatsApp and WeChat Personal show a QR code for instant pairing. No server configuration or webhook wiring required.

## Supported AI backends

ClawScale doesn't lock you into one AI provider. Bring your own keys, mix providers freely, and switch at any time — zero vendor lock-in:

| Backend | Description |
|---|---|
| **OpenClaw** | One or more OpenClaw instances with their own tools, memory, and prompts |
| **OpenAI** | GPT models via OpenAI API |
| **Anthropic** | Claude models via Anthropic API |
| **OpenRouter** | Access hundreds of models through one API key |
| **Pulse** | Pulse Editor AI agent |
| **CLI Bridge** | Any local CLI agent (e.g. Claude Code) running on your machine — connected via WebSocket tunnel, no public IP needed |
| **Custom** | Any OpenAI-compatible endpoint (vLLM, Ollama, self-hosted models, etc.) |

Users can have multiple backends active at once. Replies are labeled by source (e.g. `[GPT-4o]`, `[Claude]`) so users know which agent is responding.

## Getting started

### Prerequisites

- Node.js 20+
- pnpm
- Docker (for PostgreSQL)

### Quick start

```bash
# 1. Start Postgres
docker compose up postgres -d

# 2. Configure environment
cp .env.example .env
# Edit .env — defaults work for local dev

# 3. Install dependencies
pnpm install

# 4. Push database schema
cd packages/api && pnpm db:push && cd ../..

# 5. Start API and web (separate terminals)
cd packages/api && pnpm dev
cd packages/web && pnpm dev
```

- **Dashboard**: http://localhost:4040
- **API**: http://localhost:4041

Or run everything with Docker:

```bash
cp .env.example .env
docker compose up --build
```

Open the dashboard and **Register** to create your project. You're the admin. From here you can add channels, connect AI backends, and have your first chatbot live in under 5 minutes.

## How it works

```
End-user (WhatsApp, Discord, Slack, etc.)
    |
    v
Channel Adapter ──> POST /gateway/:channelId
    |
    v
Message Router
    ├── Parse commands (/team, /backends, etc.)
    ├── Resolve target backend(s)
    ├── Load conversation history
    ├── Call AI backend(s)
    └── Save messages + return reply
    |
    v
Channel Adapter ──> Reply to end-user
```

1. A user sends a message on any connected platform
2. The channel adapter normalizes the message and forwards it to ClawScale
3. ClawScale routes the message to the right AI backend(s), keeping each user's conversation history isolated
4. The AI response is sent back through the same channel

## Consumer onboarding portal

ClawScale generates a consumer-facing onboarding page for your end-users. Share a single URL and they'll see every connected channel with one-click connection:

```
https://your-clawscale-instance/onboard?tenant=your-project
```

| Channel | How users connect |
|---|---|
| Discord | OAuth invite link — adds the bot to their server |
| WhatsApp | Save the number and send a message, or scan a QR code |
| WeChat | Scan a QR code with the WeChat app |
| Telegram | One-click link opens a chat with the bot |
| Slack | Install link adds the app to their Slack workspace |
| LINE, Signal, Teams, Matrix, Web Chat | Platform-specific connect link or instructions |

**White-label branding** — admins can customize the onboarding portal from the dashboard:

- Custom headline and subtitle
- Custom logo
- Accent color
- Option to hide the "Powered by ClawScale" footer

This means developers set up the channels once, and ClawScale provides a polished, branded portal that end-users interact with directly — no additional frontend work needed.

## Attachment support

ClawScale passes attachments (images, audio, video, documents) from users straight through to your AI backends. Supported on every channel that carries media:

| Channel | Supported attachment types |
|---|---|
| WhatsApp (Personal & Business) | Images, audio, video, documents |
| Discord | Images, files |
| Telegram | Photos, documents, audio, video |
| Slack | Files |
| LINE | Images, audio, video, files |
| Signal | Attachments |
| Matrix | Files |
| Microsoft Teams | Files |
| WeChat Personal & WeCom | Images |

AI backends that support vision (e.g. GPT-4o, Claude 3) will receive image attachments as part of the conversation. Other backends receive a placeholder noting the attachment.

## CLI Bridge

Run any local CLI agent (such as Claude Code) on your machine and connect it to ClawScale as a backend — no public IP or server deployment required.

```
Your Machine                          ClawScale Server
+-----------------+                   +------------------+
| Local Agent     |                   |                  |
| (Claude Code)   |<-- spawn         |   ClawScale API  |
|                 |                   |                  |
| clawscale-bridge|---WebSocket------>|   /bridge (WS)   |
|                 |   (outbound)      |                  |
+-----------------+                   +------------------+
                                             |
                                      Chat Platforms
                                      (Telegram, Discord, etc.)
```

**Quick start:**

1. Go to **AI Backends** in the dashboard, click **Add backend**, choose **CLI Bridge**, and copy the generated bridge token.
2. Run the bridge on your machine:

```bash
npx @clawscale/cli-bridge \
  --server wss://your-clawscale-server/bridge \
  --token brg_xxxxxxxxxxxx \
  --agent claude-code
```

The bridge opens an outbound WebSocket connection (no inbound ports needed) and reconnects automatically with exponential backoff if it drops.

| Option | Description |
|---|---|
| `--server` | ClawScale WebSocket URL, e.g. `wss://your-server/bridge` |
| `--token` | Bridge token from the dashboard |
| `--agent` | Agent type — currently `claude-code` |

## Chat commands

End-users can run commands directly in chat to manage their experience:

| Command | What it does |
|---|---|
| `/backends` | List available AI backends |
| `/team` | Show which backends are active |
| `/team invite <name>` | Add a backend to the conversation |
| `/team kick <name>` | Remove a backend |
| `/clear` | Delete conversation history |
| `/help` | Show all commands |

To message a specific backend: `gpt> explain quantum computing`

## Multi-tenant isolation

ClawScale is designed for multi-user deployments. Every user's conversations, memory, and state are fully isolated — data never crosses boundaries.

**Access control** — project admins decide who can interact with the bot:

- **Anonymous** — anyone can chat (default)
- **Whitelist** — only approved users
- **Blacklist** — block specific users

**Roles** — each project has three roles:

| Role | Access |
|---|---|
| **Admin** | Full access — channels, backends, settings, members, audit logs |
| **Member** | Manage conversations |
| **Viewer** | Read-only access |

**Plans**: Starter (5 members, 3 channels), Business (50 members, 20 channels), Enterprise (unlimited).

## Why ClawScale over building it yourself?

Most teams that want IM chatbots end up gluing together webhook handlers, message queues, user-state stores, and AI API calls — and then doing it again for every new platform. ClawScale replaces all of that with a single gateway that already handles multi-tenant isolation, conversation routing, attachment forwarding, and backend orchestration out of the box.

## Comparison with OpenClaw

ClawScale originated from [OpenClaw](https://github.com/pulseeditor/openclaw). OpenClaw bundles messaging gateways and an AI agent into one process — great for personal use, but conversations bleed into each other when multiple users share the same instance.

ClawScale separates the gateway layer from the agent layer, so each can scale independently:

| | OpenClaw | ClawScale |
|---|---|---|
| **Architecture** | Monolithic — gateways + agent in one process | Decoupled — gateway layer + pluggable agent backends |
| **Users** | Single user, shared memory | Multi-tenant with isolated memory per user |
| **Agents** | One built-in agent | Multiple backends per tenant |
| **Scaling** | One instance | Horizontal — multiple agents behind one gateway |
| **Admin controls** | None | Dashboard with RBAC, audit logs, access policies |
| **Time to deploy** | Manual setup per platform | Minutes — dashboard-driven, no code required |

## Tech stack

- **API** — [Hono](https://hono.dev) + [Prisma](https://prisma.io) + PostgreSQL
- **Web** — [Next.js](https://nextjs.org) 16 + React 19 + Tailwind CSS
- **AI** — OpenAI SDK, Anthropic SDK, LangChain
- **Monorepo** — pnpm workspaces

```
packages/
├── api/       # Backend, channel adapters, AI routing, Prisma schema
├── web/       # Next.js dashboard
└── shared/    # Shared TypeScript types
```

## Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing auth tokens |
| `OPENAI_API_KEY` | OpenAI API key (optional) |
| `CORS_ORIGIN` | Frontend URL (default: `http://localhost:4040`) |
| `PORT` | API port (default: `4041`) |
| `WHATSAPP_AUTH_DIR` | WhatsApp session files directory (default: `./data/whatsapp`) |
| `OPENCLAW_IMAGE` | Docker image used for isolated OpenClaw runtimes (default: `1panel/openclaw:latest`) |
| `OPENCLAW_DOCKER_ISOLATION` | Set to `false` to disable per-user Docker runtimes and use the backend `baseUrl` directly |
| `OPENCLAW_DATA_DIR` | Root directory for isolated OpenClaw state/workspace data (default: `./data/tenants`) |
| `OPENCLAW_GATEWAY_TOKEN` | Optional token passed to isolated OpenClaw gateway containers |
| `OPENCLAW_DOCKER_NETWORK` | Optional Docker network for app-to-OpenClaw container traffic |
| `OPENCLAW_MODEL_PROVIDER_ID` | Optional default OpenClaw model provider id, e.g. `minimax` |
| `OPENCLAW_MODEL_PROVIDER_BASE_URL` | Optional default OpenClaw model provider base URL |
| `OPENCLAW_MODEL_PROVIDER_API_KEY` | Optional default OpenClaw model provider API key |
| `OPENCLAW_MODEL_PROVIDER_API` | OpenClaw provider API type (default: `openai-completions`) |
| `OPENCLAW_DEFAULT_MODEL` | Optional default OpenClaw model id |
| `OPENCLAW_READY_TIMEOUT_MS` | How long to wait for an isolated OpenClaw gateway to become ready (default: `180000`) |
| `OPENCLAW_CHAT_TIMEOUT_MS` | How long to wait for an OpenClaw chat completion (default: `180000`) |
| `OPENCLAW_MAX_COMPLETION_TOKENS` | Max completion tokens sent to OpenClaw OpenAI-compatible chat completions (default: `512`) |
| `OPENCLAW_PREWARM_CHAT` | Set to `true` to prewarm with a chat completion. By default ClawScale only prewarms `/v1/models` to avoid competing with real user messages |
| `OPENCLAW_SHARED_RUNTIME_DEPS` | Share OpenClaw plugin dependency cache across isolated runtimes while keeping state/workspace isolated (default: `true`) |

## License

MIT
