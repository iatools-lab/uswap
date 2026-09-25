import type { User } from "../../api/auth-api";
import type { OperationData } from "../operations/types";
import { AbsenceDeclaration } from "./AbsenceDeclaration";
import { MyAttendanceHistory } from "./MyAttendanceHistory";

export function SwapperPanel({
  user,
  data,
  onChanged,
}: {
  user: User;
  data: OperationData;
  onChanged: () => void;
}) {
  return (
    <>
      <AbsenceDeclaration shifts={data.shifts} onDeclared={onChanged} />
      <MyAttendanceHistory swapperId={user.id} />
    </>
  );
}
