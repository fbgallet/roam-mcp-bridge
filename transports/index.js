const HttpTransport = require('./HttpTransport');
const SSETransport = require('./SSETransport');

/**
 * Transport factory - creates the appropriate transport based on configuration
 */
class TransportFactory {
  static detectTransportType(config) {
    // Use explicit transport if specified
    if (config.transport) {
      return config.transport;
    }
    
    // Auto-detect based on URL pattern
    if (config.url) {
      if (config.url.endsWith('/sse')) {
        return 'sse';
      }
      if (config.url.includes('/sse/') || config.url.includes('sse.')) {
        return 'sse';
      }
    }
    
    // Default to http
    return 'http';
  }

  static createTransport(config, serverName) {
    const transportType = this.detectTransportType(config);
    
    console.log(`Creating ${transportType} transport for ${serverName}`);
    
    switch (transportType) {
      case 'sse':
        return new SSETransport(config, serverName);
      case 'http':
      default:
        return new HttpTransport(config, serverName);
    }
  }
}

module.exports = {
  TransportFactory,
  HttpTransport,
  SSETransport
};