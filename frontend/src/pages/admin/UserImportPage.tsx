import { useNavigate } from "react-router-dom";
import { UserImport } from "../../features/users/UserImport";

export function UserImportPage() {
  const navigate = useNavigate();
  return (
    <UserImport
      onBack={() => navigate("/app/admin/utilisateurs")}
      onCreated={() => navigate("/app/admin/utilisateurs")}
    />
  );
}
