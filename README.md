# proappstore-mcp — MOVED (archived)

> **This repo is archived.** The MCP Worker now lives in the platform monorepo:
>
> **→ `proappstore-online/platform` → `packages/mcp/`**
> (locally: `~/dev/stores/pas/platform/packages/mcp/`)

Still deploys as the same `proappstore-mcp` Worker (`mcp.proappstore.online`) via
`.github/workflows/deploy-mcp.yml`. The move also fixed undeclared phantom deps
(`@modelcontextprotocol/sdk`, `zod`) that were never typechecked here.

Consolidated 2026-06-02. History preserved here; **make changes in
`platform/packages/mcp/`.**
