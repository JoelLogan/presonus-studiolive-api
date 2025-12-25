# PreSonus StudioLive III API

An unofficial API for the PreSonus StudioLive III consoles.

Tested against the following models:

* StudioLive 16 Mixer
* StudioLive 16R Rack Mixer
* StudioLive 24R Rack Mixer

---

## Installation

### For Development

Clone the repository and install dependencies:

```bash
git clone https://github.com/JoelLogan/presonus-studiolive-api.git
cd presonus-studiolive-api
npm install
npm run build
```

### As a Dependency

To use this library in your project, you can install it directly from GitHub:

```bash
npm install JoelLogan/presonus-studiolive-api#v1.7.2
```

Or install from a local clone:

```bash
cd /path/to/presonus-studiolive-api
npm install
npm run build
npm link

cd /path/to/your-project
npm link presonus-studiolive-api
```

## Usage

[Refer to the documentation](https://featherbear.cc/presonus-studiolive-api)

### Quick Start

A complete example is provided in `example.js`. To run it:

1. Update the IP address in `example.js` to match your mixer
2. Run: `node example.js`

### Quick Example

```javascript
const { Client } = require('presonus-studiolive-api');

const client = new Client({
  host: '192.168.1.100',  // Replace with your mixer's IP address
  port: 53000
}, {
  autoreconnect: true,
  logLevel: 'info'
});

client.on('connected', () => {
  console.log('Connected to mixer!');
});

client.connect();
```

## Development

### Build

```bash
npm run build
```

### Lint

```bash
npm run lint
```

### Format Code

```bash
npm run format
```

### Test

Update the IP address in `test.ts` to match your mixer, then run:

```bash
npm test
```

---

## License

Copyright © 2019 - 2025 Andrew Wong  

This software is licensed under the [MIT License](https://opensource.org/licenses/MIT).  
You are free to redistribute it and/or modify it under the [terms](https://opensource.org/licenses/MIT) of the [license](https://opensource.org/licenses/MIT).
