import { useNavigate } from "react-router-dom";
import { UserImport } from "../../features/users/UserImport";
import { useAppPath } from "../../app/appBase";

export function UserImportPage() {
  const navigate = useNavigate();
  const path = useAppPath();
  return (
    <UserImport
      onBack={() => navigate(path("/app/admin/utilisateurs"))}
      onCreated={() => navigate(path("/app/admin/utilisateurs"))}
    />
  );
}
