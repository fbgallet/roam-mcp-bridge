const Transport = require('./Transport');
// Use Node.js built-in fetch (available in Node 18+)
const { fetch } = globalThis;

class HttpTransport extends Transport {
  constructor(config, serverName) {
    super(config, serverName);
  }

  async initialize() {
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

    try {
      await this.sendMessage(initMessage);
      
      const initializedMessage = {
        jsonrpc: '2.0',
        method: 'notifications/initialized'
      };
      
      await this.sendMessage(initializedMessage);
      this.initialized = true;
      
      console.log(`HTTP transport initialized for ${this.serverName}`);
    } catch (error) {
      console.error(`Failed to initialize HTTP transport for ${this.serverName}:`, error);
      throw error;
    }
  }

  async sendMessage(message) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    };

    // Only exclude sessionId for the initial 'initialize' request
    const isInitializeRequest = message.method === 'initialize';
    if (!isInitializeRequest) {
      headers['Mcp-Session-Id'] = this.sessionId || 'session-' + Date.now();
    }

    if (this.config.auth) {
      switch (this.config.auth.type) {
        case 'bearer':
          headers['Authorization'] = `Bearer ${this.resolveEnvVar(this.config.auth.token)}`;
          break;
        case 'apikey':
          headers[this.config.auth.header || 'X-API-Key'] = this.resolveEnvVar(this.config.auth.key);
          break;
        case 'basic':
          const credentials = Buffer.from(`${this.resolveEnvVar(this.config.auth.username)}:${this.resolveEnvVar(this.config.auth.password)}`).toString('base64');
          headers['Authorization'] = `Basic ${credentials}`;
          break;
      }
    }

    try {
      console.log(`Sending request to ${this.config.url}:`, {
        headers,
        body: JSON.stringify(message, null, 2)
      });
      
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(message),
        timeout: this.config.timeout || 30000
      });

      if (!response.ok) {
        const responseText = await response.text();
        console.log(`Response headers:`, Object.fromEntries(response.headers.entries()));
        console.log(`Response body:`, responseText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Extract session ID from response headers if present
      const sessionId = response.headers.get('mcp-session-id');
      if (sessionId) {
        console.log('Server provided session ID:', sessionId);
        this.sessionId = sessionId;
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('text/event-stream')) {
        // Handle SSE response
        const text = await response.text();
        console.log('Received SSE response:', text);
        
        // Parse SSE format to extract JSON data
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonData = line.substring(6); // Remove "data: " prefix
            if (jsonData.trim()) {
              try {
                return JSON.parse(jsonData);
              } catch (e) {
                console.log('Failed to parse SSE data:', jsonData);
                continue;
              }
            }
          }
        }
        throw new Error('No valid JSON data found in SSE response');
      } else {
        // Handle JSON response
        const text = await response.text();
        if (!text.trim()) {
          // Empty response (common for notifications)
          console.log('Received empty response (likely notification acknowledgment)');
          return { success: true };
        }
        try {
          const result = JSON.parse(text);
          return result;
        } catch (e) {
          console.log('Failed to parse JSON response:', text);
          throw new Error(`Invalid JSON response: ${text}`);
        }
      }
    } catch (error) {
      console.error(`HTTP transport request failed for ${this.serverName}:`, error);
      throw error;
    }
  }

  resolveEnvVar(value) {
    if (typeof value === 'string' && value.startsWith('$')) {
      return process.env[value.substring(1)] || value;
    }
    return value;
  }

  async close() {
    // HTTP transport doesn't maintain persistent connections
    this.initialized = false;
    console.log(`HTTP transport closed for ${this.serverName}`);
  }
}

module.exports = HttpTransport;