import type { OperationData } from "../operations/types";
import { AbsenceDeclaration } from "./AbsenceDeclaration";

export function SwapperPanel({
  data,
  onChanged,
}: {
  data: OperationData;
  onChanged: () => void;
}) {
  return <AbsenceDeclaration shifts={data.shifts} onDeclared={onChanged} />;
}
