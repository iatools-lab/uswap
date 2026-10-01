import { api } from "../auth-api";
import type { LeaveGateway, CreateLeaveCommand, UpdateLeaveCommand } from "./leave-gateway";
import type { LeaveBalanceView, LeaveRequestView, LeaveWorkspaceView } from "../../domain/sprint4";

export const mockLeaveGateway: LeaveGateway = {
  getWorkspace: () => api<LeaveWorkspaceView>("/leaves/workspace"),
  async getBalance() { return (await this.getWorkspace()).balance; },
  create: (command: CreateLeaveCommand) => api<LeaveRequestView>("/leaves", command),
  update: (id: string, command: UpdateLeaveCommand) => api<LeaveRequestView>(`/leaves/${id}`, command, "PATCH"),
  cancel: (id: string, idempotencyKey: string) => api<LeaveRequestView>(`/leaves/${id}/cancel`, { idempotencyKey }),
  retry: async (operationId: string) => { await api(`/leaves/sync/${operationId}/retry`, {}); },
};
