/**
 * Example usage of the PreSonus StudioLive API
 * 
 * Before running this example:
 * 1. Update the host IP address below to match your mixer
 * 2. Ensure your mixer is on the same network
 * 3. Run: node example.js
 */

const { Client, MessageCode, Discovery } = require('./dist/cjs/api');

// Option 1: Discover mixers on the network
async function discoverMixers() {
  console.log('Discovering PreSonus StudioLive mixers on the network...');
  
  const discovery = new Discovery();
  
  discovery.on('device', (device) => {
    console.log('Found mixer:', device);
  });
  
  await discovery.start(5000); // Search for 5 seconds
  discovery.stop();
}

// Option 2: Connect directly to a known mixer
function connectToMixer() {
  const client = new Client({
    host: '192.168.1.100',  // Replace with your mixer's IP address
    port: 53000
  }, {
    autoreconnect: true,
    logLevel: 'info'
  });

  // Event: Connection established
  client.on('connected', () => {
    console.log('✓ Connected to mixer!');
    console.log(`  Host: ${client.serverHost}`);
    console.log(`  Port: ${client.serverPort}`);
  });

  // Event: Connection closed
  client.on('closed', () => {
    console.log('✗ Connection closed');
  });

  // Event: Reconnecting (when autoreconnect is enabled)
  client.on('reconnecting', () => {
    console.log('⟳ Reconnecting to mixer...');
  });

  // Event: Receive parameter value changes
  client.on(MessageCode.ParamValue, (data) => {
    console.log('Parameter changed:', data);
  });

  // Event: Receive all data
  client.on('data', ({ code, data }) => {
    // Process all incoming messages
    // console.log('Received message:', code, data);
  });

  // Establish connection
  client.connect().then(() => {
    console.log('Connection established successfully');
    
    // Example: Request mixer information
    // Add your custom logic here
    
  }).catch((error) => {
    console.error('Failed to connect:', error);
  });

  return client;
}

// Main execution
async function main() {
  console.log('PreSonus StudioLive API Example\n');
  
  // Uncomment the method you want to use:
  
  // Method 1: Discover mixers
  // await discoverMixers();
  
  // Method 2: Connect directly
  const client = connectToMixer();
  
  // Keep the process running
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    if (client && client.conn) {
      client.disconnect();
    }
    process.exit(0);
  });
}

main();
