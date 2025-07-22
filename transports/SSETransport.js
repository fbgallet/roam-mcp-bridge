const Transport = require('./Transport');
// Use Node.js built-in fetch (available in Node 18+)
const { fetch } = globalThis;

class SSETransport extends Transport {
  constructor(config, serverName) {
    super(config, serverName);
    this.eventSource = null;
    this.pendingRequests = new Map(); // Map request IDs to Promise resolvers
    this.requestCounter = 0;
    this.messageQueue = [];
    this.isConnecting = false;
    this.messageEndpoint = null; // URL for sending messages
  }

  async initialize() {
    if (this.isConnecting) {
      throw new Error('SSE connection already in progress');
    }

    this.isConnecting = true;
    
    try {
      // Establish SSE connection
      const response = await fetch(this.config.url, {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to establish SSE connection: HTTP ${response.status}: ${response.statusText}`);
      }

      // Parse the SSE stream
      this.parseSSEStream(response.body);
      
      // Send initialization sequence
      await this.sendInitializationMessages();
      
      this.initialized = true;
      this.isConnecting = false;
      
      console.log(`SSE transport initialized for ${this.serverName}`);
      
    } catch (error) {
      this.isConnecting = false;
      console.error(`Failed to initialize SSE transport for ${this.serverName}:`, error);
      throw error;
    }
  }

  async parseSSEStream(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const processStream = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            console.log(`SSE stream ended for ${this.serverName}`);
            this.handleDisconnection();
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          
          // Process complete SSE events
          let eventEndIndex;
          while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
            const eventData = buffer.substring(0, eventEndIndex);
            buffer = buffer.substring(eventEndIndex + 2);
            
            this.processSSEEvent(eventData);
          }
        }
      } catch (error) {
        console.error(`SSE stream error for ${this.serverName}:`, error);
        this.handleDisconnection();
      }
    };

    // Start processing stream in background
    processStream();
  }

  processSSEEvent(eventData) {
    const lines = eventData.split('\n');
    let event = 'message';
    let data = '';
    let id = null;

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        event = line.substring(7);
      } else if (line.startsWith('data: ')) {
        data += line.substring(6) + '\n';
      } else if (line.startsWith('id: ')) {
        id = line.substring(4);
      }
    }

    data = data.trim();

    console.log(`Received SSE event [${event}]:`, data);

    if (event === 'message' && data) {
      try {
        const message = JSON.parse(data);
        this.handleMessage(message);
      } catch (error) {
        console.error('Failed to parse SSE message:', data, error);
      }
    } else if (event === 'endpoint' && data) {
      // Handle endpoint event - server provides URL for sending messages
      this.messageEndpoint = data.startsWith('http') ? data : this.config.url.replace(/\/[^\/]*$/, '') + data;
      console.log(`Message endpoint set for ${this.serverName}:`, this.messageEndpoint);
      
      // Process any queued messages now that we have the endpoint
      this.processQueuedMessages();
    } else if (event === 'ping') {
      // Handle ping events for connection keepalive
      console.log(`Received ping from ${this.serverName}`);
    }
  }

  handleMessage(message) {
    // Handle JSON-RPC responses
    if (message.id && this.pendingRequests.has(message.id)) {
      const resolver = this.pendingRequests.get(message.id);
      this.pendingRequests.delete(message.id);
      
      if (message.error) {
        resolver.reject(new Error(`JSON-RPC error: ${message.error.message}`));
      } else {
        resolver.resolve(message);
      }
    } else {
      // Handle notifications or unsolicited messages
      console.log(`Received unsolicited message from ${this.serverName}:`, message);
    }
  }

  handleDisconnection() {
    this.initialized = false;
    
    // Reject all pending requests
    for (const [id, resolver] of this.pendingRequests) {
      resolver.reject(new Error('SSE connection lost'));
    }
    this.pendingRequests.clear();
    
    // TODO: Implement reconnection logic
    console.warn(`SSE connection lost for ${this.serverName}`);
  }

  async sendInitializationMessages() {
    // Send initialize message
    const initMessage = {
      jsonrpc: '2.0',
      id: this.getNextRequestId(),
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

    const initResponse = await this.sendMessage(initMessage);
    
    // Extract session info from response if available
    if (initResponse.result) {
      console.log('SSE Initialize response:', initResponse.result);
    }

    // Send initialized notification
    const initializedMessage = {
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    };

    await this.sendMessage(initializedMessage);
  }

  async sendMessage(message) {
    if (!this.initialized && !this.isConnecting) {
      throw new Error('SSE transport not initialized');
    }

    // Assign ID for request tracking (if not already present)
    if (!message.id && message.method !== 'notifications/initialized') {
      message.id = this.getNextRequestId();
    }

    return new Promise((resolve, reject) => {
      // For notifications, resolve immediately
      if (message.method && message.method.startsWith('notifications/')) {
        this.sendSSEMessage(message);
        resolve({ success: true });
        return;
      }

      // For requests, track the response
      if (message.id) {
        this.pendingRequests.set(message.id, { resolve, reject });
        
        // Set timeout for request
        setTimeout(() => {
          if (this.pendingRequests.has(message.id)) {
            this.pendingRequests.delete(message.id);
            reject(new Error(`Request timeout for message ID ${message.id}`));
          }
        }, this.config.timeout || 30000);
      }

      this.sendSSEMessage(message);
    });
  }

  async sendSSEMessage(message) {
    if (this.messageEndpoint) {
      // Send directly to the message endpoint
      await this.postToEndpoint(message);
    } else {
      // Queue message until endpoint is available
      this.messageQueue.push(message);
      console.log(`Queued SSE message for ${this.serverName}:`, JSON.stringify(message, null, 2));
    }
  }

  async processQueuedMessages() {
    if (!this.messageEndpoint || this.messageQueue.length === 0) {
      return;
    }

    console.log(`Processing ${this.messageQueue.length} queued messages for ${this.serverName}`);
    
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      try {
        await this.postToEndpoint(message);
      } catch (error) {
        console.error(`Failed to send queued message:`, error);
        // Re-queue the message for retry
        this.messageQueue.unshift(message);
        break;
      }
    }
  }

  async postToEndpoint(message) {
    if (!this.messageEndpoint) {
      throw new Error('No message endpoint available');
    }

    console.log(`Sending SSE message to ${this.messageEndpoint}:`, JSON.stringify(message, null, 2));

    const response = await fetch(this.messageEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
      timeout: this.config.timeout || 30000
    });

    if (!response.ok) {
      throw new Error(`Failed to send message: HTTP ${response.status}: ${response.statusText}`);
    }

    // Note: Response comes back via SSE stream, not HTTP response
    console.log(`Message sent successfully to ${this.serverName}`);
  }

  getNextRequestId() {
    return ++this.requestCounter;
  }

  async close() {
    this.initialized = false;
    
    // Close the event source if it exists
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Reject all pending requests
    for (const [id, resolver] of this.pendingRequests) {
      resolver.reject(new Error('Transport closed'));
    }
    this.pendingRequests.clear();
    
    console.log(`SSE transport closed for ${this.serverName}`);
  }
}

module.exports = SSETransport;