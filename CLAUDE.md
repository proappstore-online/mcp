# ProAppStore MCP Server

Remote MCP server for AI agents to interact with the ProAppStore platform.

- Endpoint: `mcp.proappstore.online/mcp`
- Dev: `npm install && npm run dev`
- Deploy: `git push origin main` (auto-deploys via GitHub Actions)

## Tools

### Platform tools (built-in)

| Tool | Auth | Description |
|------|------|-------------|
| `list_apps` | Session token | List your published Pro apps |
| `deploy_status` | None | Check GitHub Actions deploy status |
| `app_info` | None | Get app URLs, repo, data worker, status |
| `platform_guide` | None | Fetch skills.md (full platform guide) |
| `sdk_reference` | None | Quick SDK reference (auth, db, storage, maps, AI, subscriptions, hooks, UI) |
| `discover_tools` | None | List all app data tools available across the platform |

### Agent-team introspection tools

| Tool | Auth | Description |
|------|------|-------------|
| `agent_project_status` | Session token | Project status — running/paused, monthly cost vs cap |
| `agent_board` | Session token | Full Kanban board — all tickets grouped by status |
| `agent_activity` | Session token | Activity log (audit trail) — every action, tool call, transition, error |
| `agent_ticket_detail` | Session token | One ticket's full conversation (BA spec, Dev notes, QA reports, deploy results) |
| `agent_cost` | Session token | Cost breakdown per role with token counts |

### App tools (dynamic)

Apps declare tools via `mcp.json` in their repo root. When published with `pas publish`,
tools are registered in the platform and exposed as `{appId}/{toolName}` (e.g. `jobs/list_jobs`).
Use `discover_tools` to see all available app tools.

## Connect from Claude Code

```json
{
  "mcpServers": {
    "proappstore": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.proappstore.online/mcp"]
    }
  }
}
```
