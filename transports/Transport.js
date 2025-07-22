// Base Transport class - defines the interface all transports must implement
class Transport {
  constructor(config, serverName) {
    this.config = config;
    this.serverName = serverName;
    this.sessionId = null;
    this.initialized = false;
  }

  /**
   * Initialize the transport connection
   * @returns {Promise<void>}
   */
  async initialize() {
    throw new Error('initialize() must be implemented by transport subclass');
  }

  /**
   * Send a message to the MCP server
   * @param {Object} message - JSON-RPC message
   * @returns {Promise<Object>} - Response from server
   */
  async sendMessage(message) {
    throw new Error('sendMessage() must be implemented by transport subclass');
  }

  /**
   * Close the transport connection
   * @returns {Promise<void>}
   */
  async close() {
    throw new Error('close() must be implemented by transport subclass');
  }

  /**
   * Check if transport is connected and ready
   * @returns {boolean}
   */
  isConnected() {
    return this.initialized;
  }
}

module.exports = Transport;