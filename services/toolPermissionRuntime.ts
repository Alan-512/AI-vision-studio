import type { ToolClass } from './agentKernelTypes';

export type ToolPermissionPolicy = 'allow' | 'deny';

export interface ToolPermissionDecision {
  allowed: boolean;
  errorType?: 'permission_denied';
  reason?: string;
}

export const evaluateToolPermission = ({
  policy,
  reason
}: {
  toolName: string;
  toolClass: ToolClass;
  policy?: ToolPermissionPolicy;
  reason?: string;
}): ToolPermissionDecision => {
  if (policy === 'deny') {
    return {
      allowed: false,
      errorType: 'permission_denied',
      reason: reason || 'Tool execution denied by policy'
    };
  }

  return {
    allowed: true
  };
};
