import type {
  LeaveBalanceView,
  LeaveRequestInput,
  LeaveRequestView,
  LeaveWorkspaceView,
} from "../../domain/sprint4";

/** Contrat frontend pour consulter et gérer les demandes de congés dans uSwap. */
export interface LeaveGateway {
  getWorkspace(): Promise<LeaveWorkspaceView>;
  getBalance(): Promise<LeaveBalanceView>;
  submitRequest(input: LeaveRequestInput): Promise<LeaveRequestView>;
  updateRequest(
    id: string,
    input: LeaveRequestInput,
  ): Promise<LeaveRequestView>;
  cancelRequest(id: string): Promise<LeaveRequestView>;
}
