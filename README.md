# MCP HTTP Bridge

A simple, reliable HTTP bridge for stdio MCP (Model Context Protocol) servers that enables browser-based applications to interact with MCP servers through standard HTTP requests.

## Features

- **HTTP API with CORS**: Browser-friendly HTTP endpoints with full CORS support
- **Process Management**: Spawns and manages MCP servers as child processes
- **Session Persistence**: Maintains session state between HTTP requests
- **Environment Variables**: Support for configuring MCP servers with environment variables
- **Multiple Server Support**: Run multiple MCP servers simultaneously
- **JSON-RPC Forwarding**: Transparent forwarding of JSON-RPC messages between HTTP clients and stdio MCP servers
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

For multiple servers, expand your `config.json`:

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
    "database": {
      "command": "python",
      "args": ["-m", "mcp_server_database"],
      "env": {
        "DATABASE_URL": "sqlite:///app.db"
      }
    }
  }
}
```

All servers will be accessible on the same port:
- `http://localhost:8000/rpc/@readwise/readwise-mcp`
- `http://localhost:8000/rpc/filesystem`
- `http://localhost:8000/rpc/database`

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
    "alive": true,
    "pid": 12345
  }
}
```

## Configuration

### Command Line Arguments

- `--port <number>`: HTTP server port (default: 3000, or PORT environment variable)
- `--server <spec>`: Single server specification (npm package or command)
- `--config <path>`: Path to configuration file (default: config.json)

### Server Configuration

Each server in the configuration file supports:

- `command`: The executable command (e.g., "npx", "python", "node")
- `args`: Array of command arguments
- `env`: Environment variables for the server process

### Environment Variable Support

Environment variables can be passed through in several ways:

1. **Direct in config**: Set actual values in the config file
2. **Template substitution**: Use `${VAR_NAME}` syntax (future enhancement)
3. **Process environment**: Variables are automatically inherited

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

### Process Management
- Servers are automatically restarted if they crash
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
