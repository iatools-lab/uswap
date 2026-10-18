import { api } from "../auth-api";
import type { LeaveGateway } from "./leave-gateway";
import type {
  LeaveBalanceView,
  LeaveRequestInput,
  LeaveRequestView,
  LeaveWorkspaceView,
} from "../../domain/sprint4";

export const mockLeaveGateway: LeaveGateway = {
  getWorkspace: () => api<LeaveWorkspaceView>("/leaves/workspace"),
  async getBalance() {
    return (await this.getWorkspace()).balance;
  },
  submitRequest: (input: LeaveRequestInput) =>
    api<LeaveRequestView>("/leaves", input, "POST"),
  updateRequest: (id: string, input: LeaveRequestInput) =>
    api<LeaveRequestView>(`/leaves/${encodeURIComponent(id)}`, input, "PATCH"),
  cancelRequest: (id: string) =>
    api<LeaveRequestView>(
      `/leaves/${encodeURIComponent(id)}/cancel`,
      {},
      "PATCH",
    ),
};
