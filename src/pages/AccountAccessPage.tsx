import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { AccountAccess } from "../features/account/AccountAccess";
import { AuthLayout } from "./AuthLayout";

const titles = {
  activate: "Activation",
  reset: "Réinitialisation",
  forgot: "Mot de passe oublié",
} as const;

export function AccountAccessPage({ mode }: { mode: "forgot" | "activate" | "reset" }) {
  const location = useLocation();
  useEffect(() => {
    document.title = `${titles[mode]} · uSwap`;
  }, [mode, location.pathname]);
  return (
    <AuthLayout>
      <AccountAccess mode={mode} />
    </AuthLayout>
  );
}
