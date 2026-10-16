import { createServer } from './app.js';
import { readConfig } from './config.js';

const app = createServer(readConfig(process.env));
await app.listen({ host: '127.0.0.1', port: 4318 });
console.info('Voxa API listening at http://127.0.0.1:4318');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
