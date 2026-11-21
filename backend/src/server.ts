import { createApp } from './app.js';
import { config } from './config.js';
import { log } from './log.js';

createApp().listen(config.port, () => log('api-started', { port: config.port }));
