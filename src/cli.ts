#!/usr/bin/env node
import { parseArgs } from 'util';
import { createServer } from 'http';
import '../dist/index.js'; // starts the server

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    port: { type: 'string', default: '3001' },
    host: { type: 'string', default: '0.0.0.0' },
  },
});

process.env.PORT = values.port;
process.env.HOST = values.host;
