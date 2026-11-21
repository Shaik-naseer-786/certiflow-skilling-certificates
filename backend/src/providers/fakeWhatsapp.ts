import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { config } from '../config.js';

// A stand-in for the real WhatsApp Business API. It misbehaves on purpose:
//   - fails      -> throws, nothing delivered (like a 503)
//   - times out  -> message IS delivered but the reply never comes back in time
//                   (the nastiest real-world case: did it send or not?)
//   - succeeds   -> delivered and acknowledged
// Delivery is recorded in ProviderMessage with a unique idempotency key, so if we
// retry a send that actually went through, the provider ignores the duplicate.

export type Outcome = 'success' | 'fail' | 'timeout';

type Behaviour = { rng: () => number; failRate: number; timeoutRate: number; timeoutDelayMs: number };
const behaviour: Behaviour = {
  rng: Math.random,
  failRate: config.whatsapp.failRate,
  timeoutRate: config.whatsapp.timeoutRate,
  timeoutDelayMs: config.whatsapp.callTimeoutMs * 3,
};

// Tests use this to make the provider deterministic.
export function setProviderBehaviour(b: Partial<Behaviour>) {
  Object.assign(behaviour, b);
}

function pickOutcome(): Outcome {
  const r = behaviour.rng();
  if (r < behaviour.failRate) return 'fail';
  if (r < behaviour.failRate + behaviour.timeoutRate) return 'timeout';
  return 'success';
}

async function deliver(idempotencyKey: string, phone: string, body: string) {
  try {
    await prisma.providerMessage.create({ data: { idempotencyKey, phone, body } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return; // already delivered
    throw e;
  }
}

export async function sendWhatsApp(msg: { idempotencyKey: string; phone: string; body: string }): Promise<void> {
  const outcome = pickOutcome();
  if (outcome === 'fail') throw new Error('WhatsApp provider error 503');
  await deliver(msg.idempotencyKey, msg.phone, msg.body);
  if (outcome === 'timeout') await new Promise((r) => setTimeout(r, behaviour.timeoutDelayMs)); // reply "lost"
}
