/**
 * Agent-team introspection tools for the MCP server.
 * Exposes the full agent pipeline state: project status, board (tickets),
 * activity log (audit trail), ticket conversations, and cost — so any
 * AI agent (or Claude Code) can diagnose what the agent team is doing
 * without opening the console UI.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const AGENTS_API = "https://agents.proappstore.online";

/**
 * Call the agents API. Prefers the user's session token; falls back to the
 * internal service token (X-Internal-Token) so the MCP tools work even when
 * the caller didn't connect with auth (e.g. Claude Code via mcp-remote).
 */
async function agentsApi(
  path: string,
  userToken: string | null,
  internalToken: string | null,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (userToken) {
    headers.Authorization = `Bearer ${userToken}`;
  } else if (internalToken) {
    headers["X-Internal-Token"] = internalToken;
  } else {
    return { ok: false, status: 401, data: { error: "no auth available" } };
  }
  const res = await fetch(`${AGENTS_API}${path}`, { headers });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = { error: await res.text().catch(() => "unknown") };
  }
  return { ok: res.ok, status: res.status, data };
}

function txt(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function registerAgentsTools(
  server: McpServer,
  getUserContext: () => { userId: string | null; token: string | null },
  internalToken: string | null,
): void {
  // ── agent_project_status ────────────────────────────────────
  server.tool(
    "agent_project_status",
    "Get the agent team's project status for an app — running/paused, monthly cost, budget cap. Shows whether agents are active and why they might have stopped.",
    { app_id: z.string().describe("App ID (slug)") },
    async ({ app_id }) => {
      const { token } = getUserContext();
      const r = await agentsApi(`/v1/projects/${app_id}`, token, internalToken);
      if (!r.ok) {
        if (r.status === 404) return txt(`No agent team found for "${app_id}". Start one from the console.`);
        return txt(`Error: ${r.status} ${JSON.stringify(r.data)}`);
      }
      const p = r.data as {
        id: string; name: string; slug: string; status: string;
        costSpentMonthlyUsd: number; costCapMonthlyUsd: number; repoUrl?: string;
      };
      return txt([
        `**${p.name}** (${p.slug})`,
        `Status: ${p.status === "running" ? "RUNNING" : "PAUSED"}`,
        `Monthly cost: $${(p.costSpentMonthlyUsd ?? 0).toFixed(2)} / $${(p.costCapMonthlyUsd ?? 50).toFixed(2)} cap`,
        p.repoUrl ? `Repo: ${p.repoUrl}` : null,
      ].filter(Boolean).join("\n"));
    },
  );

  // ── agent_board ─────────────────────────────────────────────
  server.tool(
    "agent_board",
    "Get the full Kanban board — all tickets with their status, assignee, iteration count, and cost. Shows the pipeline state: inbox, ba-refining, awaiting-approval, ready, dev-active, qa-active, qa-failed, deploying, needs-input, done, failed, cancelled.",
    { app_id: z.string().describe("App ID (slug)") },
    async ({ app_id }) => {
      const { token } = getUserContext();
      const [projR, ticketsR] = await Promise.all([
        agentsApi(`/v1/projects/${app_id}`, token, internalToken),
        agentsApi(`/v1/projects/${app_id}/tickets`, token, internalToken),
      ]);
      if (!projR.ok) return txt(`Error fetching project: ${projR.status}`);
      if (!ticketsR.ok) return txt(`Error fetching tickets: ${ticketsR.status}`);

      const p = projR.data as { status: string; costSpentMonthlyUsd: number; costCapMonthlyUsd: number };
      const tickets = ((ticketsR.data as { tickets: unknown[] }).tickets ?? []) as Array<{
        id: string; seq: number; title: string; status: string;
        assigneeRole: string | null; iterations: number;
        costSpentUsd: number; stuckReason: string | null;
        rawIdea?: string; createdAt: number; updatedAt: number;
      }>;

      if (tickets.length === 0) return txt(`Project is ${p.status}. No tickets on the board.`);

      // Group by status
      const groups = new Map<string, typeof tickets>();
      for (const t of tickets) {
        const list = groups.get(t.status) ?? [];
        list.push(t);
        groups.set(t.status, list);
      }

      const lines = [`**Project: ${p.status}** | $${(p.costSpentMonthlyUsd ?? 0).toFixed(2)}/$${(p.costCapMonthlyUsd ?? 50).toFixed(2)}`, ""];
      const order = [
        "needs-input", "dev-active", "qa-active", "ba-refining",
        "deploying", "qa-failed", "awaiting-approval", "ready",
        "inbox", "done", "failed", "cancelled",
      ];
      for (const status of order) {
        const group = groups.get(status);
        if (!group) continue;
        lines.push(`### ${status} (${group.length})`);
        for (const t of group) {
          const parts = [`#${t.seq} ${t.title}`];
          if (t.assigneeRole) parts.push(`[${t.assigneeRole}]`);
          if (t.iterations > 0) parts.push(`iter:${t.iterations}`);
          if (t.costSpentUsd > 0) parts.push(`$${t.costSpentUsd.toFixed(3)}`);
          if (t.stuckReason) parts.push(`\n  STUCK: ${t.stuckReason}`);
          lines.push(`- ${parts.join(" ")}`);
        }
        lines.push("");
      }
      return txt(lines.join("\n"));
    },
  );

  // ── agent_activity ──────────────────────────────────────────
  server.tool(
    "agent_activity",
    "Get the activity log (audit trail) for an app's agent team. Shows every action: agent starts, tool calls, transitions, deploy results, errors, cost events. This is the primary debugging tool for understanding why the pipeline stopped.",
    {
      app_id: z.string().describe("App ID (slug)"),
      last: z.number().optional().describe("Show only the last N entries (default: all)"),
    },
    async ({ app_id, last }) => {
      const { token } = getUserContext();
      const r = await agentsApi(`/v1/projects/${app_id}/activity`, token, internalToken);
      if (!r.ok) return txt(`Error: ${r.status}`);

      let entries = ((r.data as { activity: unknown[] }).activity ?? []) as Array<{
        id: string; type: string; detail: string; createdAt: number; meta?: string;
      }>;
      if (last && last > 0) entries = entries.slice(-last);
      if (entries.length === 0) return txt("No activity recorded yet.");

      const lines = entries.map((e) => {
        const ts = new Date(e.createdAt).toISOString().replace("T", " ").slice(0, 19);
        return `${ts} [${e.type}] ${e.detail}`;
      });
      return txt(lines.join("\n"));
    },
  );

  // ── agent_ticket_detail ─────────────────────────────────────
  server.tool(
    "agent_ticket_detail",
    "Get a ticket's full conversation — all agent messages (BA spec, Dev code notes, QA reports, system deploy results). Shows the complete audit trail for one ticket including stuck reasons.",
    {
      app_id: z.string().describe("App ID (slug)"),
      ticket_seq: z.number().describe("Ticket number (e.g. 1 for #1)"),
    },
    async ({ app_id, ticket_seq }) => {
      const { token } = getUserContext();

      // First get the ticket list to find the ID from seq
      const ticketsR = await agentsApi(`/v1/projects/${app_id}/tickets`, token, internalToken);
      if (!ticketsR.ok) return txt(`Error: ${ticketsR.status}`);
      const tickets = ((ticketsR.data as { tickets: unknown[] }).tickets ?? []) as Array<{
        id: string; seq: number; title: string; status: string;
        assigneeRole: string | null; iterations: number;
        costSpentUsd: number; stuckReason: string | null; rawIdea?: string;
      }>;
      const ticket = tickets.find((t) => t.seq === ticket_seq);
      if (!ticket) return txt(`Ticket #${ticket_seq} not found. Available: ${tickets.map((t) => `#${t.seq}`).join(", ") || "none"}`);

      // Get messages
      const msgsR = await agentsApi(`/v1/projects/${app_id}/tickets/${ticket.id}/messages`, token, internalToken);
      const messages = msgsR.ok
        ? (((msgsR.data as { messages: unknown[] }).messages ?? []) as Array<{
            id: string; author: string; body: string; createdAt: number;
          }>)
        : [];

      const lines = [
        `**#${ticket.seq} ${ticket.title}**`,
        `Status: ${ticket.status} | Assignee: ${ticket.assigneeRole ?? "none"} | Iterations: ${ticket.iterations} | Cost: $${(ticket.costSpentUsd ?? 0).toFixed(3)}`,
      ];
      if (ticket.stuckReason) lines.push(`STUCK: ${ticket.stuckReason}`);
      if (ticket.rawIdea) lines.push(`\nIdea: ${ticket.rawIdea}`);
      lines.push(`\n--- Messages (${messages.length}) ---`);

      for (const m of messages) {
        const ts = new Date(m.createdAt).toISOString().replace("T", " ").slice(0, 19);
        // Cap each message body to keep output manageable
        const body = m.body.length > 2000 ? m.body.slice(0, 2000) + "... [truncated]" : m.body;
        lines.push(`\n[${ts}] **${m.author}**:\n${body}`);
      }
      return txt(lines.join("\n"));
    },
  );

  // ── agent_cost ──────────────────────────────────────────────
  server.tool(
    "agent_cost",
    "Get the cost breakdown for an app's agent team — per-role spend, token counts, and monthly total.",
    { app_id: z.string().describe("App ID (slug)") },
    async ({ app_id }) => {
      const { token } = getUserContext();
      const r = await agentsApi(`/v1/projects/${app_id}/cost`, token, internalToken);
      if (!r.ok) return txt(`Error: ${r.status}`);
      return txt(JSON.stringify(r.data, null, 2));
    },
  );
}
