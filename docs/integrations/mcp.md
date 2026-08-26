# MCP Server Integration

Configure Cursor or any MCP-capable client:

```json
{
  "mcpServers": {
    "stellaragent": {
      "command": "npx",
      "args": ["@stellaragent/mcp-server"],
      "env": {
        "AGENT_SECRET": "S...",
        "SESSION_BUDGET": "10"
      }
    }
  }
}
```

## Tools

| Tool | Description |
| --- | --- |
| `stellaragent_quote` | Pre-flight prediction via `predictPaymentOutcome` |
| `stellaragent_pay` | Pay for an API call |
| `stellaragent_channel_status` | Channel spend report |
| `stellaragent_rate_limits` | On-chain rate limit status |
| `stellaragent_create_job` | Agent-to-agent escrow |

Payments are refused with explicit reasons when prediction or session policy
would block. Key material is never included in tool results.
