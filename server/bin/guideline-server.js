#!/usr/bin/env node
import { start } from '../src/main.js';

const r = await start({ env: process.env });
if (r.code !== 0) process.exit(r.code);

const stop = async () => {
  await r.close();
  process.exit(0);
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
