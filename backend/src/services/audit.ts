import type { Tx } from '../db.js';

export type Actor = { id: string; name: string } | null; // null = the system itself

// Always called with the same transaction as the change it describes, so a
// change and its audit record either both exist or neither does.
export async function writeAudit(
  tx: Tx,
  actor: Actor,
  action: string,
  entity: 'Batch' | 'Certificate',
  entityId: string,
  meta?: Record<string, unknown>,
) {
  await tx.auditLog.create({
    data: {
      actorId: actor?.id ?? null,
      actorName: actor?.name ?? 'system',
      action,
      entity,
      entityId,
      meta: (meta ?? {}) as object,
    },
  });
}
