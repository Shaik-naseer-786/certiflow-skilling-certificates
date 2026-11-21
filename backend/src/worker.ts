import { prisma } from './db.js';
import { scheduleMaintenance } from './queue.js';
import { startWorkers } from './jobs/workers.js';
import { log } from './log.js';

// Entry point of the worker container. Run several copies to scale.
const workers = startWorkers();
await scheduleMaintenance(); // repeating job: escalation + sweeper
log('worker-started');

const shutdown = async () => {
  await workers.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
