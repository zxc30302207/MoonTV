import { NextRequest, NextResponse } from 'next/server';

import { db } from './db';
import {
  MutationNamespace,
  NamespaceMutation,
  NamespaceVersion,
} from './mutation-protocol';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const revision = /^(0|[1-9][0-9]{0,18})$/;

export function namespaceJson(
  body: unknown,
  version?: NamespaceVersion,
  status = 200
) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
      ...(version
        ? {
            'X-MoonTV-Epoch': version.epoch,
            'X-MoonTV-Revision': version.revision,
          }
        : {}),
    },
  });
}

export async function mutateFromRequest(
  request: NextRequest,
  username: string,
  namespace: MutationNamespace,
  input: Pick<NamespaceMutation, 'action' | 'key' | 'value'>
) {
  const epoch = request.headers?.get('X-MoonTV-Epoch');
  const currentRevision = request.headers?.get('X-MoonTV-Revision');
  const operationId = request.headers?.get('X-MoonTV-Operation-Id');
  if (!epoch || !currentRevision || !operationId) {
    return namespaceJson(
      { error: '請重新整理頁面以更新同步版本。', code: 'VERSION_REQUIRED' },
      undefined,
      428
    );
  }
  if (
    !uuid.test(epoch) ||
    !uuid.test(operationId) ||
    !revision.test(currentRevision) ||
    BigInt(currentRevision) > BigInt('9223372036854775806')
  ) {
    return namespaceJson(
      { error: 'Invalid mutation version', code: 'INVALID_VERSION' },
      undefined,
      400
    );
  }
  const result = await db.mutateNamespace(username, namespace, {
    ...input,
    version: { epoch, revision: currentRevision },
    operationId,
  });
  return namespaceJson(
    namespace === 'sh' && input.action === 'add'
      ? result.data
      : { success: true, duplicate: result.duplicate },
    result.version
  );
}

export function namespaceError(error: unknown) {
  if (error instanceof Error && error.name === 'NamespaceConflictError') {
    return namespaceJson(
      {
        error: '資料已在其他裝置變更，請重新載入後確認要保留的操作。',
        code: 'VERSION_CONFLICT',
      },
      undefined,
      409
    );
  }
  // Missing RPCs and transport errors fail closed; never fall back to blind KV writes.
  return namespaceJson(
    { error: '同步服務暫時無法使用，請稍後重試。', code: 'SYNC_UNAVAILABLE' },
    undefined,
    503
  );
}
