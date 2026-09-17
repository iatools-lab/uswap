import { useEffect, useState } from "react";
import { StepperModal, type StepItem } from "../../ui/StepperModal";
import { UserRound, Eye, EyeOff, CheckCheck } from "../../ui/icons";
import { api, roles, type Role } from "../../api/auth-api";
import { StationPicker } from "../stations/StationPicker";
import { Select } from "../../ui/Select";
interface UserCreateModalProps {
  open: boolean;
  stations: { id: string; name: string }[];
  onClose: () => void;
  onCreated: () => void;
}

export function UserCreateModal({ open, stations, onClose, onCreated }: UserCreateModalProps) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("");
  const [stationId, setStationId] = useState("");

  // Nouveau state pour choisir la méthode d'activation
  const [activationMethod, setActivationMethod] = useState<"link" | "password">("link");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const resetForm = () => {
    setFullName("");
    setEmail("");
    setRole("");
    setStationId("");
    setActivationMethod("link");
    setPassword("");
    setError("");
  };

  // Repart d'un formulaire vierge à chaque ouverture du modal.
  useEffect(() => {
    if (open) resetForm();
  }, [open]);

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async () => {
    setError("");
    setBusy(true);
    
    const isPasswordMode = activationMethod === "password";

    try {
      await api("/auth/register", {
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        role,
        accountStatus: isPasswordMode ? "ACTIVE" : "PENDING",
        sendInvite: !isPasswordMode,
        ...(isPasswordMode ? { password } : {}),
        ...(stationId ? { stationId } : {}),
      });
      resetForm();
      onCreated();
      onClose();
    } catch (err) {
      setError((err as Error).message || "Une erreur est survenue lors de la création.");
    } finally {
      setBusy(false);
    }
  };

  const steps: StepItem[] = [
    {
      id: "info",
      label: "Informations",
      isValid: () => fullName.trim() !== "" && email.includes("@"),
      content: (
        <div className="stepper-form-layout">
          <div className="stepper-field-group">
            <label htmlFor="fullName">NOM COMPLET *</label>
            <input
              id="fullName"
              type="text"
              required
              placeholder="ex: Jean Dupont"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>

          <div className="stepper-field-group">
            <label htmlFor="email">ADRESSE E-MAIL *</label>
            <input
              id="email"
              type="email"
              required
              placeholder="collaborateur@uswap.cm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>
      ),
    },
    {
      id: "role-station",
      label: "Rôle & Station",
      isValid: () => !!role && Object.keys(roles).includes(role),
      content: (
        <div className="stepper-form-layout">
          <div className="stepper-field-group">
            <label>RÔLE DANS L'ÉCOSYSTÈME *</label>
            <Select
              value={role}
              onChange={(value) => setRole(String(value))}
              placeholder="Sélectionner un rôle"
              options={Object.entries(roles).map(([val, label]) => ({
                label,
                value: val,
              }))}
            />
          </div>

          <div className="stepper-field-group">
            <label>STATION RATTACHÉE</label>
            <StationPicker
  value={stationId}
  onChange={setStationId}
  stations={stations}
/>
          </div>
        </div>
      ),
    },
    {
      id: "summary",
      label: "Récapitulatif",
      // On bloque l'étape finale si le mode mot de passe est actif mais qu'il fait moins de 8 caractères
      isValid: () => activationMethod === "link" || (activationMethod === "password" && password.length >= 8),
      content: (
        <div className="stepper-form-layout">
          {error && <p className="error-message">{error}</p>}

          <div className="stepper-summary-card">
            <div className="summary-row">
              <span>Collaborateur :</span>
              <strong>{fullName || "—"}</strong>
            </div>
            <div className="summary-row">
              <span>E-mail :</span>
              <strong>{email || "—"}</strong>
            </div>
            <div className="summary-row">
              <span>Rôle attribué :</span>
              <strong>{role ? roles[role as keyof typeof roles] : "—"}</strong>
            </div>
            <div className="summary-row">
              <span>Station :</span>
              <strong>{stations.find((s) => s.id === stationId)?.name || "Aucune"}</strong>
            </div>
          </div>

          <div className="activation-field">
            <label>MÉTHODE D'ACTIVATION DU COMPTE *</label>

            <div className="activation-switch">
              <label className={`activation-option${activationMethod === "link" ? " is-selected" : ""}`}>
                <input type="radio" name="activation" value="link" checked={activationMethod === "link"} onChange={() => setActivationMethod("link")} />
                <span>Envoyer un lien</span>
              </label>

              <label className={`activation-option${activationMethod === "password" ? " is-selected" : ""}`}>
                <input type="radio" name="activation" value="password" checked={activationMethod === "password"} onChange={() => setActivationMethod("password")} />
                <span>Définir un mot de passe</span>
              </label>
            </div>
          </div>

          {activationMethod === "link" ? (
            <div className="activation-notice">
              <CheckCheck size={18} />
              <p>
                Un e-mail d'invitation sera envoyé à <strong>{email || "l'utilisateur"}</strong> contenant un lien sécurisé pour qu'il définisse lui-même son propre mot de passe.
              </p>
            </div>
          ) : (
            <div className="stepper-field-group is-tight">
              <label htmlFor="password">MOT DE PASSE PROVISOIRE (Min. 8 caractères) *</label>
              <div className="input-wrap">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Saisissez un mot de passe sécurisé..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={password.length > 0 && password.length < 8 ? "field-invalid" : undefined}
                />
                <button
                  type="button"
                  className="eye-button"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {password.length > 0 && password.length < 8 && (
                <span className="field-error-inline">Le mot de passe doit contenir au moins 8 caractères.</span>
              )}
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <StepperModal
      open={open}
      title="Nouveau collaborateur"
      icon={<UserRound size={20} />}
      steps={steps}
      submitLabel="Créer l'utilisateur"
      busy={busy}
      onClose={handleClose}
      onSubmit={handleSubmit}
    />
  );
}
