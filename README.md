# MCP HTTP Bridge

A simple, reliable HTTP bridge for both stdio and remote MCP (Model Context Protocol) servers that enables browser-based applications to interact with MCP servers through standard HTTP requests.

Originally created to allow the [Live AI extension](https://github.com/fbgallet/roam-extension-live-ai-assistant) in Roam Research to connect to MCP servers, since web environments cannot directly use stdio communication.

## Features

- **HTTP API with CORS**: Browser-friendly HTTP endpoints with full CORS support
- **Multi-Transport Support**: Connect to local stdio, remote HTTP, and remote SSE MCP servers
- **Process Management**: Spawns and manages local MCP servers as child processes
- **Remote MCP Support**: Direct connections to remote MCP servers via HTTP or SSE with authentication
- **Transport Auto-Detection**: Automatically detects transport type based on URL patterns
- **Session Persistence**: Maintains session state between HTTP requests
- **Environment Variables**: Support for configuring MCP servers with environment variables
- **Multiple Server Support**: Run multiple local and remote MCP servers simultaneously
- **JSON-RPC Forwarding**: Transparent forwarding of JSON-RPC messages between HTTP clients and MCP servers
- **Authentication Support**: Bearer token, API key, and Basic auth for remote servers
- **Health Monitoring**: Built-in health checks and server status endpoints

## Installation

1. Clone this repository:
```bash
git clone <repository-url>
cd mcp-http-bridge
```

2. Install dependencies:
```bash
npm install
```

## Quick Start

### Configuration File Usage (Recommended)

The easiest way to use the bridge is with a configuration file:

1. Copy the example configuration:
```bash
cp config.json.example config.json
```

2. Edit `config.json` with your server configurations and API tokens:
```json
{
  "servers": {
    "@readwise/readwise-mcp": {
      "command": "npx",
      "args": ["@readwise/readwise-mcp"],
      "env": {
        "READWISE_TOKEN": "your_actual_readwise_token_here"
      }
    }
  }
}
```

3. Start the bridge (config.json is loaded automatically):
```bash
node bridge.js --port 8000
```

4. Access your servers:
- Readwise: `http://localhost:8000/rpc/@readwise/readwise-mcp`
- Health check: `http://localhost:8000/health`

### Command Line Usage

Alternatively, run a single MCP server with environment variables:

```bash
# With npm package (note the quotes around the server name)
ACCESS_TOKEN=your_token node bridge.js --server "@readwise/readwise-mcp" --port 8000

# With custom command
API_KEY=your_key node bridge.js --server "python -m my_mcp_server" --port 8000
```

### Advanced Configuration File Usage

For multiple local and remote servers, expand your `config.json`:

```json
{
  "servers": {
    "@readwise/readwise-mcp": {
      "command": "npx",
      "args": ["@readwise/readwise-mcp"],
      "env": {
        "READWISE_TOKEN": "your_readwise_token"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["@anthropic/filesystem-mcp"],
      "env": {}
    },
    "deepwiki-http": {
      "type": "remote",
      "url": "https://mcp.deepwiki.com/mcp",
      "transport": "http"
    },
    "deepwiki-sse": {
      "type": "remote",
      "url": "https://mcp.deepwiki.com/sse",
      "transport": "sse"
    },
    "remote-api": {
      "type": "remote",
      "url": "https://api.example.com/mcp",
      "auth": {
        "type": "bearer",
        "token": "${API_KEY}"
      },
      "timeout": 30000
    }
  }
}
```

All servers will be accessible on the same port:
- `http://localhost:8000/rpc/@readwise/readwise-mcp` (local stdio)
- `http://localhost:8000/rpc/filesystem` (local stdio)
- `http://localhost:8000/rpc/deepwiki-http` (remote HTTP)
- `http://localhost:8000/rpc/deepwiki-sse` (remote SSE)
- `http://localhost:8000/rpc/remote-api` (remote HTTP with auth)

## API Endpoints

### POST /rpc/:server

Send JSON-RPC messages to a specific MCP server.

**Parameters:**
- `server`: The server name (from config or CLI)

**Request Body:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [...]
  }
}
```

### GET /health

Check bridge health and list active servers.

**Response:**
```json
{
  "status": "ok",
  "servers": ["@readwise/readwise-mcp", "filesystem"]
}
```

### GET /servers

Get detailed status of all configured servers.

**Response:**
```json
{
  "@readwise/readwise-mcp": {
    "type": "local",
    "alive": true,
    "pid": 12345
  },
  "remote-claude": {
    "type": "remote",
    "alive": true,
    "url": "https://api.anthropic.com/v1/mcp"
  }
}
```

## Configuration

### Command Line Arguments

- `--port <number>`: HTTP server port (default: 3000, or PORT environment variable)
- `--server <spec>`: Single server specification (npm package or command)
- `--config <path>`: Path to configuration file (default: config.json)

### Server Configuration

#### Local Servers (stdio)

Each local server in the configuration file supports:

- `command`: The executable command (e.g., "npx", "python", "node")
- `args`: Array of command arguments
- `env`: Environment variables for the server process

#### Remote Servers (HTTP/SSE)

Each remote server supports:

- `type`: Must be "remote"
- `url`: Endpoint URL for the MCP server
- `transport`: Transport type ("http" or "sse") - optional, auto-detected if not specified
- `auth`: Authentication configuration (optional)
  - `type`: Authentication type ("bearer", "apikey", "basic")
  - `token`: Bearer token (for bearer auth)
  - `key`: API key value (for apikey auth)
  - `header`: Custom header name (for apikey auth, default: "X-API-Key")
  - `username`/`password`: Credentials (for basic auth)
- `timeout`: Request timeout in milliseconds (default: 30000)

#### Transport Types

The bridge supports multiple transport protocols for remote MCP servers:

**HTTP Transport (default)**
- Uses standard HTTP POST requests with JSON-RPC
- Best for simple, stateless MCP servers
- Example: `"url": "https://api.example.com/mcp"`

**SSE Transport (Server-Sent Events)**
- Uses persistent connections with bidirectional messaging
- Better for servers requiring session management
- Auto-detected for URLs ending in `/sse`
- Example: `"url": "https://mcp.deepwiki.com/sse"`

**Auto-Detection Rules:**
- URLs ending with `/sse` → SSE transport
- URLs containing `/sse/` or `sse.` → SSE transport  
- All other URLs → HTTP transport
- Explicit `"transport"` property overrides auto-detection

### Environment Variable Support

Environment variables can be used in both local and remote server configurations:

1. **Direct in config**: Set actual values in the config file
2. **Template substitution**: Use `${VAR_NAME}` syntax for secure token management
3. **Process environment**: Variables are automatically inherited

Examples:
```json
{
  "servers": {
    "local-server": {
      "command": "npx",
      "args": ["@readwise/readwise-mcp"],
      "env": {
        "API_TOKEN": "${MY_API_TOKEN}"
      }
    },
    "http-server": {
      "type": "remote",
      "url": "https://api.example.com/mcp",
      "transport": "http",
      "auth": {
        "type": "bearer",
        "token": "${REMOTE_API_KEY}"
      }
    },
    "sse-server": {
      "type": "remote",
      "url": "https://mcp.deepwiki.com/sse",
      "transport": "sse"
    },
    "auto-detected-sse": {
      "type": "remote",
      "url": "https://example.com/sse"
      // transport: "sse" is auto-detected from URL
    }
  }
}
```

## Usage Examples

### Browser Extension Integration

```javascript
// In your browser extension or web app
async function callMCPServer(method, params = {}) {
  const response = await fetch('http://localhost:8000/rpc/@readwise/readwise-mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: method,
      params: params
    })
  });
  
  return await response.json();
}

// List available tools
const tools = await callMCPServer('tools/list');

// Call a specific tool
const result = await callMCPServer('tools/call', {
  name: 'search_highlights',
  arguments: { query: 'artificial intelligence' }
});
```

### Multiple Server Setup

```bash
# Start with config file for multiple servers
node bridge.js --config config.json --port 8000

# Access different servers via different endpoints:
# http://localhost:8000/rpc/@readwise/readwise-mcp
# http://localhost:8000/rpc/filesystem
# http://localhost:8000/rpc/database
```

## Common MCP Server Examples

### Readwise MCP
```bash
READWISE_TOKEN=your_token node bridge.js --server "@readwise/readwise-mcp" --port 8000
```

### Filesystem MCP
```bash
node bridge.js --server filesystem-mcp
```

### Custom Python MCP Server
```bash
API_KEY=your_key node bridge.js --server "python -m my_mcp_server --verbose"
```

## Troubleshooting

### Command Line Arguments
- **Important**: Always quote server names that start with `@` or contain spaces
- Correct: `--server "@readwise/readwise-mcp"`
- Incorrect: `--server @readwise/readwise-mcp` (shell will interpret @ symbol)

### Server Won't Start
- Check that the MCP server command is valid and installed
- Verify required environment variables are set
- Check the console output for error messages

### Connection Issues
- Ensure CORS is enabled (it is by default)
- Check that the bridge is running on the expected port
- Verify the server name in the URL matches your configuration

### Transport-Specific Issues

**HTTP Transport:**
- Check that the remote server accepts POST requests
- Verify authentication headers are correct
- Ensure the server returns valid JSON responses

**SSE Transport:**
- Check that the server supports Server-Sent Events
- Verify the server accepts persistent connections
- Look for connection timeout or stream parsing errors

### Process Management
- Local servers are automatically restarted if they crash
- Remote servers automatically reconnect on connection loss
- Use `GET /servers` to check server status
- Check console logs for detailed error information

## Development

### Running in Development Mode
```bash
npm run dev
```

### Logging
The bridge logs all HTTP requests and MCP server interactions to the console.

## License

MIT
