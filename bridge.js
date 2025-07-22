#!/usr/bin/env node

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { TransportFactory } = require('./transports');

class MCPBridge {
  constructor() {
    this.app = express();
    this.mcpProcesses = new Map();
    this.sessions = new Map();
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(cors({
      origin: ['https://roamresearch.com', 'http://localhost:*', 'http://127.0.0.1:*'],
      credentials: true
    }));
    this.app.use(express.json());
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
      next();
    });
  }

  setupRoutes() {
    this.app.post('/rpc/:server(*)', this.handleRPC.bind(this));
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', servers: Array.from(this.mcpProcesses.keys()) });
    });
    this.app.get('/servers', (req, res) => {
      const servers = {};
      this.mcpProcesses.forEach((process, name) => {
        if (process.type === 'remote') {
          servers[name] = {
            type: 'remote',
            alive: true,
            url: process.config.url
          };
        } else {
          servers[name] = {
            type: 'local',
            alive: process.process && !process.process.killed,
            pid: process.process ? process.process.pid : null
          };
        }
      });
      res.json(servers);
    });
    
    // Debug route to see all requests
    this.app.use((req, res, next) => {
      console.log(`Unmatched route: ${req.method} ${req.path}`);
      next();
    });
  }

  async handleRPC(req, res) {
    const serverName = decodeURIComponent(req.params.server);
    const message = req.body;
    console.log(`Handling RPC for server: "${serverName}"`);

    try {
      const mcpProcess = await this.getMCPProcess(serverName);
      if (!mcpProcess) {
        return res.status(500).json({ error: `Server ${serverName} not configured` });
      }

      let response;
      if (mcpProcess.type === 'remote') {
        response = await mcpProcess.transport.sendMessage(message);
      } else {
        response = await this.sendToMCPServer(mcpProcess, message);
      }
      res.json(response);
    } catch (error) {
      console.error(`Error handling RPC for ${serverName}:`, error);
      res.status(500).json({ error: error.message });
    }
  }

  async getMCPProcess(serverName) {
    if (this.mcpProcesses.has(serverName)) {
      const existing = this.mcpProcesses.get(serverName);
      if (existing.type === 'remote' && existing.transport && existing.transport.isConnected()) {
        return existing;
      } else if (existing.type !== 'remote' && existing.process && !existing.process.killed) {
        return existing;
      }
    }

    const config = this.getServerConfig(serverName);
    if (!config) {
      return null;
    }

    if (config.type === 'remote') {
      return this.createRemoteMCPConnection(serverName, config);
    }

    return this.spawnMCPProcess(serverName, config);
  }

  getServerConfig(serverName) {
    if (this.cliServer && serverName === this.cliServer.name) {
      return this.cliServer.config;
    }

    if (this.config && this.config.servers && this.config.servers[serverName]) {
      return this.config.servers[serverName];
    }

    return null;
  }

  async spawnMCPProcess(serverName, config) {
    console.log(`Spawning MCP server: ${serverName}`);
    
    const env = { ...process.env, ...config.env };
    const childProcess = spawn(config.command, config.args || [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: env
    });

    const mcpProcess = {
      process: childProcess,
      messageQueue: [],
      responseHandlers: new Map(),
      initialized: false
    };

    childProcess.stdout.on('data', (data) => {
      this.handleMCPOutput(mcpProcess, data);
    });

    childProcess.stderr.on('data', (data) => {
      console.error(`${serverName} stderr:`, data.toString());
    });

    childProcess.on('exit', (code) => {
      console.log(`${serverName} exited with code ${code}`);
      this.mcpProcesses.delete(serverName);
    });

    childProcess.on('error', (error) => {
      console.error(`${serverName} error:`, error);
      this.mcpProcesses.delete(serverName);
    });

    this.mcpProcesses.set(serverName, mcpProcess);

    await this.initializeMCPServer(mcpProcess);
    return mcpProcess;
  }

  handleMCPOutput(mcpProcess, data) {
    const lines = data.toString().split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      try {
        const message = JSON.parse(line);
        
        if (message.id && mcpProcess.responseHandlers.has(message.id)) {
          const handler = mcpProcess.responseHandlers.get(message.id);
          mcpProcess.responseHandlers.delete(message.id);
          handler.resolve(message);
        } else {
          console.log('Received notification or unhandled message:', message);
        }
      } catch (error) {
        console.error('Failed to parse MCP output:', line, error);
      }
    }
  }

  async initializeMCPServer(mcpProcess) {
    const initMessage = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          roots: {
            listChanged: true
          },
          sampling: {}
        },
        clientInfo: {
          name: 'mcp-http-bridge',
          version: '1.0.0'
        }
      }
    };

    await this.sendToMCPServer(mcpProcess, initMessage);
    
    const initializedMessage = {
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    };

    mcpProcess.process.stdin.write(JSON.stringify(initializedMessage) + '\n');
    mcpProcess.initialized = true;
    console.log('MCP server initialized');
  }

  sendToMCPServer(mcpProcess, message) {
    return new Promise((resolve, reject) => {
      if (!mcpProcess.process || mcpProcess.process.killed) {
        reject(new Error('MCP process not available'));
        return;
      }

      if (message.id) {
        const timeout = setTimeout(() => {
          mcpProcess.responseHandlers.delete(message.id);
          reject(new Error('Request timeout'));
        }, 30000);

        mcpProcess.responseHandlers.set(message.id, {
          resolve: (response) => {
            clearTimeout(timeout);
            resolve(response);
          },
          reject: reject
        });
      }

      try {
        mcpProcess.process.stdin.write(JSON.stringify(message) + '\n');
        
        if (!message.id) {
          resolve({ jsonrpc: '2.0', result: 'notification sent' });
        }
      } catch (error) {
        if (message.id) {
          mcpProcess.responseHandlers.delete(message.id);
        }
        reject(error);
      }
    });
  }

  async createRemoteMCPConnection(serverName, config) {
    console.log(`Creating remote MCP connection: ${serverName}`);
    
    // Create transport using the factory
    const transport = TransportFactory.createTransport(config, serverName);
    
    // Initialize the transport
    await transport.initialize();
    
    const remoteConnection = {
      type: 'remote',
      serverName: serverName,
      config: config,
      transport: transport,
      initialized: true
    };

    this.mcpProcesses.set(serverName, remoteConnection);
    
    return remoteConnection;
  }


  resolveEnvVar(value) {
    if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
      const envVar = value.slice(2, -1);
      return process.env[envVar] || value;
    }
    return value;
  }

  loadConfig(configPath) {
    try {
      const configData = fs.readFileSync(configPath, 'utf8');
      this.config = JSON.parse(configData);
      console.log(`Loaded configuration from ${configPath}`);
    } catch (error) {
      console.warn(`Could not load config from ${configPath}:`, error.message);
      this.config = null;
    }
  }

  parseCliArgs() {
    const args = process.argv.slice(2);
    const parsed = {};
    
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--port' && i + 1 < args.length) {
        parsed.port = parseInt(args[i + 1]);
        i++;
      } else if (args[i] === '--server' && i + 1 < args.length) {
        parsed.server = args[i + 1];
        i++;
      } else if (args[i] === '--config' && i + 1 < args.length) {
        parsed.config = args[i + 1];
        i++;
      }
    }
    
    return parsed;
  }

  setupCliServer(serverSpec) {
    if (serverSpec.startsWith('@')) {
      this.cliServer = {
        name: serverSpec,
        config: {
          command: 'npx',
          args: [serverSpec],
          env: {}
        }
      };
    } else {
      const parts = serverSpec.split(' ');
      this.cliServer = {
        name: parts[0],
        config: {
          command: parts[0],
          args: parts.slice(1),
          env: {}
        }
      };
    }
  }

  start() {
    const cliArgs = this.parseCliArgs();
    const port = cliArgs.port || process.env.PORT || 3000;
    
    if (cliArgs.config) {
      this.loadConfig(cliArgs.config);
    } else if (fs.existsSync('config.json')) {
      this.loadConfig('config.json');
    }
    
    if (cliArgs.server) {
      this.setupCliServer(cliArgs.server);
    }

    this.app.listen(port, () => {
      console.log(`MCP HTTP Bridge running on port ${port}`);
      if (this.cliServer) {
        console.log(`CLI server configured: ${this.cliServer.name}`);
        console.log(`  URL: http://localhost:${port}/rpc/${encodeURIComponent(this.cliServer.name)}`);
      }
      if (this.config && this.config.servers) {
        console.log(`Config servers: ${Object.keys(this.config.servers).join(', ')}`);
        Object.keys(this.config.servers).forEach(serverName => {
          console.log(`  ${serverName}: http://localhost:${port}/rpc/${encodeURIComponent(serverName)}`);
        });
      }
    });

    process.on('SIGINT', async () => {
      console.log('\nShutting down...');
      
      // Close all transports and processes
      for (const [name, mcpProcess] of this.mcpProcesses) {
        try {
          if (mcpProcess.type === 'remote' && mcpProcess.transport) {
            console.log(`Closing transport for ${name}...`);
            await mcpProcess.transport.close();
          } else if (mcpProcess.process && !mcpProcess.process.killed) {
            console.log(`Terminating ${name}...`);
            mcpProcess.process.kill();
          }
        } catch (error) {
          console.error(`Error closing ${name}:`, error);
        }
      }
      
      process.exit(0);
    });
  }
}

const bridge = new MCPBridge();
bridge.start();