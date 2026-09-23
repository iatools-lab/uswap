import type {
  LeaveBalanceView,
  LeaveRequestView,
  LeaveType,
  LeaveWorkspaceView,
} from "../../domain/sprint4";

export type CreateLeaveCommand = {
  startTime: string;
  endTime: string;
  type: LeaveType;
  reason: string;
  attachmentId?: string | null;
  idempotencyKey: string;
};

export type UpdateLeaveCommand = Omit<CreateLeaveCommand, "idempotencyKey"> & {
  idempotencyKey: string;
};

/**
 * Contrat stable entre l'interface et la plateforme de congés. Le lot E08
 * fournira un adaptateur mock ; une API réelle pourra ensuite le remplacer
 * sans modifier les composants React.
 */
export interface LeaveGateway {
  getWorkspace(): Promise<LeaveWorkspaceView>;
  getBalance(): Promise<LeaveBalanceView>;
  create(command: CreateLeaveCommand): Promise<LeaveRequestView>;
  update(id: string, command: UpdateLeaveCommand): Promise<LeaveRequestView>;
  cancel(id: string, idempotencyKey: string): Promise<LeaveRequestView>;
  retry(operationId: string): Promise<void>;
}
