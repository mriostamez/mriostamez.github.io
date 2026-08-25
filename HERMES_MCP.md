# Hermes Agent MCP Integration Guide

This repository contains a Model Context Protocol (MCP) Server ([`mcp-server.js`](file:///Users/DevAccount/Documents/dev/mriostamez.github.io/mcp-server.js)) that allows your **Hermes agent** (or any MCP-compliant LLM client) to programmatically view, log, update, and analyze your macro entries directly in [`data.csv`](file:///Users/DevAccount/Documents/dev/mriostamez.github.io/data.csv).

---

## 🛠 Available Tools for Hermes Agent

| Tool Name | Parameters | Description |
|---|---|---|
| `get_entries` | `startDate?`, `endDate?` | Fetches daily macro records formatted as JSON. |
| `log_day` | `date` (required), `calories?`, `carbs?`, `fat?`, `protein?` | Logs or updates macros for a day. Auto-calculates calories (`4·carb + 4·protein + 9·fat`) if calories are omitted. |
| `delete_day` | `date` (required) | Removes a daily log by ISO date (`YYYY-MM-DD`). |
| `get_summary` | None | Returns today's logged macros, 7-day average stats, and default targets. |
| `export_csv` | None | Exports the full raw contents of `data.csv`. |

---

## ⚙️ Configuration for Hermes / MCP Clients

### Hermes / Claude / Antigravity MCP Config Snippet

Add this server to your Hermes agent configuration (e.g. `mcp_config.json` or `config.json`):

```json
{
  "mcpServers": {
    "daily-macro-tracker": {
      "command": "node",
      "args": [
        "/Users/DevAccount/Documents/dev/mriostamez.github.io/mcp-server.js"
      ]
    }
  }
}
```

Or using `npm run mcp`:
```json
{
  "mcpServers": {
    "daily-macro-tracker": {
      "command": "npm",
      "args": [
        "--prefix",
        "/Users/DevAccount/Documents/dev/mriostamez.github.io",
        "run",
        "mcp"
      ]
    }
  }
}
```

---

## 💡 Example Prompt Ideas for Hermes Agent

- *"Hermes, log my macros for today: 185g carbs, 55g fat, 190g protein."*
- *"Hermes, check my 7-day macro averages and tell me if I'm hitting my targets."*
- *"Hermes, delete the macro entry for 2026-08-15."*
- *"Hermes, list all macro logs from the past week."*
