# ClawBot Agent Product Design

## Goals

ClawBot separates agent design from runtime execution:

- Models manage provider accounts and model capabilities.
- Agent Templates define reusable agent behavior.
- Channels bind a messaging entrypoint to a published Agent Template version.
- Agents are runtime instances created dynamically for end users.
- Conversations are the observable result of a Channel + Agent + Model instance.

This follows the same product split used by mature agent platforms: 1Panel separates model accounts from OpenClaw agents, OpenClaw treats the workspace as the agent context boundary, and Dify-style builders model an agent as instructions, tools, knowledge, model, and execution controls.

## Information Architecture

```text
Operations
- Conversations
- Channels
- Agents

Build
- Agent Templates
- Models
- Knowledge
- Skills

System
- Members
- Settings
- Audit Logs
```

`Agents` means running instances. `Agent Templates` means the editable design artifact.

## Models

Models are shared provider accounts.

Primary UI fields:

- Provider: OpenAI, Anthropic, MiniMax, DeepSeek, OpenRouter, Ollama, Custom.
- Base URL.
- API key.
- Synced models.
- Capability metadata: streaming, function calling, vision, JSON mode, reasoning.
- Runtime defaults: timeout, max tokens, temperature, reasoning effort.

Primary actions:

- Test connection.
- Sync model list.
- Run test prompt.
- Set default.
- View templates using the provider.

## Agent Templates

Templates are editable drafts. Publishing creates immutable versions. Channels should bind a version, not a mutable draft.

Create/edit flow:

```text
1. Basics
2. Model
3. Instructions
4. Skills
5. Workspace
6. Knowledge
7. Runtime
8. Test and Publish
```

Template configuration:

- Runtime: openclaw, hermass, custom.
- Model provider and default model.
- Identity and system prompt.
- Skills: bundled skills, ClawHub skills, custom `SKILL.md`.
- Workspace markdown: `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `USER.md`, extra docs.
- Knowledge: full-context markdown or retrieval-backed knowledge bases.
- Runtime policy: prewarm, idle stop, image, network policy, resource limits.

Publishing stores an immutable snapshot:

```json
{
  "name": "Sales Assistant",
  "runtimeType": "openclaw",
  "modelProviderId": "mp_xxx",
  "config": { "model": "MiniMax-M2.7-highspeed" },
  "skills": [],
  "workspace": [],
  "knowledgeBase": []
}
```

## Agent Runtime Instances

Instances are created when an end user talks to a channel:

```text
tenantId + channelId + endUserId + agentTemplateVersionId
```

Current compatibility can still use `backendId`, but the product model should show `agentTemplateVersionId`.

Instance UI:

- Template/version.
- Channel and end user.
- Container name.
- Runtime status.
- Last message time.
- Last latency.
- State/workspace path.
- Actions: start, stop, restart, rebuild from template, open WebUI, view logs.

Online modification rules:

- Modify Template: affects future versions only.
- Modify Instance: affects only this user runtime and marks the instance as customized.
- Upgrade Instance: materializes a newer version while preserving memory/session.
- Reset Instance: restores template-managed files only, preserving user data unless explicitly cleared.

## Channels

Channels bind an entrypoint to an Agent Template version.

Channel creation flow:

```text
1. Platform
2. Credentials
3. Agent Template
4. Template Version
5. Runtime Policy
6. Test
```

Routing modes:

- Fixed Template: all users use one template version.
- Segmented Template: future policy-based routing.
- Manual Override: future per-user override.

Phase 1 implements Fixed Template.

## OpenClaw Materialization

ClawBot compiles an Agent Template version into OpenClaw artifacts:

```text
state/openclaw.json
workspace/AGENTS.md
workspace/SOUL.md
workspace/TOOLS.md
workspace/USER.md
workspace/skills/<skill>/SKILL.md
workspace/docs/*.md
workspace/.clawbot/manifest.json
workspace/.clawbot/version.json
```

Template-managed files are overwritten when the template version changes. User memory, sessions, and non-managed workspace output are preserved.

## Implementation Phases

Phase 1:

- Add `AgentTemplateVersion`.
- Allow templates to be published.
- Let Channels bind template version.
- Show runtime instances under `Agents`.
- Materialize standard OpenClaw workspace files and custom skills.

Phase 2:

- Add first-class `AgentTemplate` table and migrate off `AiBackend`.
- Add knowledge indexing and retrieval tools.
- Add instance-level workspace editor and diff/reset.

Phase 3:

- Add segmented routing.
- Add Hermass runtime adapter.
- Add skill registry, scanner, and credential binding.
