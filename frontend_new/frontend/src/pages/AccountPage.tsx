import { AccountSettings } from "../features/account/AccountSettings";
import { useSession } from "../app/session";

export function AccountPage() {
  const { session } = useSession();
  if (!session) return null;
  return <AccountSettings user={session.user} />;
}
