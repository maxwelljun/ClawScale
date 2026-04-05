import { db } from '../db/index.js';
import { generateId } from './id.js';

export async function audit(params: {
  tenantId: string;
  memberId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  await db.auditLog.create({
    data: {
      id: generateId('aud'),
      tenantId: params.tenantId,
      memberId: params.memberId ?? null,
      action: params.action,
      resource: params.resource,
      resourceId: params.resourceId ?? null,
      meta: (params.meta ?? undefined) as any,
    },
  });
}
