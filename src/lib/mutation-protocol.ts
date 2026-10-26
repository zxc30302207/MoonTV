export type MutationNamespace = 'pr' | 'fav' | 'sh' | 'followings';

export interface NamespaceVersion {
  epoch: string;
  // PostgreSQL bigint is deliberately represented as decimal text.
  revision: string;
}

export interface NamespaceSnapshot {
  version: NamespaceVersion;
  data: Record<string, unknown> | string[];
}

export interface NamespaceMutation {
  version: NamespaceVersion;
  operationId: string;
  action: 'set' | 'delete' | 'clear' | 'add';
  key?: string;
  value?: unknown;
}

export interface NamespaceMutationResult extends NamespaceSnapshot {
  duplicate: boolean;
}

export class NamespaceConflictError extends Error {
  readonly code = 'NAMESPACE_CONFLICT';
  constructor() {
    super('資料已在其他裝置變更，請重新載入後確認操作');
    this.name = 'NamespaceConflictError';
  }
}
