import type { Role } from '@prisma/client';
import type { Prisma } from '@prisma/client';

export type AuthUser = { id: string; name: string; role: Role; district: string | null };

// Which batches may this user see? Used by every list and detail query,
// so there is exactly one place that decides visibility.
export function batchVisibility(user: AuthUser): Prisma.BatchWhereInput {
  switch (user.role) {
    case 'CENTRE':
      return { centreId: user.id };
    case 'DISTRICT_OFFICER':
      return { district: user.district ?? '__none__', status: { not: 'DRAFT' } };
    case 'QUALITY':
    case 'STATE':
      return { status: { not: 'DRAFT' } };
  }
}
