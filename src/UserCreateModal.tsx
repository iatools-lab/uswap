import { useState, useRef, useEffect } from "react";
import { StepperModal, type StepItem } from "./StepperModal";
import { UserRound, Eye, EyeOff, CheckCheck } from "./icons";
import { api, roles, type Role } from "./auth-api";
import { CaretDownIcon } from "@phosphor-icons/react";
import { StationPicker } from "./Stationpicker";
interface UserCreateModalProps {
  open: boolean;
  stations: { id: string; name: string }[];
  onClose: () => void;
  onCreated: () => void;
}

function CustomSelect({
  value,
  options,
  onChange,
  placeholder = "Sélectionner",
  width = "100%",
}: {
  value: string | number;
  options: { label: string; value: string | number }[];
  onChange: (val: any) => void;
  placeholder?: string;
  width?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const selectedOption = options.find((o) => o.value === value);

  return (
    <div ref={ref} style={{ position: "relative", width }}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: "100%",
          height: "42px",
          background: "#fff",
          border: "1px solid #cbd5e1",
          borderRadius: "8px",
          padding: "0 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "13.5px",
          color: "#0f172a",
          cursor: "pointer",
          boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: selectedOption ? "inherit" : "#94a3b8" }}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <CaretDownIcon
          size={14}
          style={{
            color: "#64748b",
            marginLeft: "8px",
            flexShrink: 0,
            transform: isOpen ? "rotate(180deg)" : "none",
            transition: "transform 0.15s ease",
          }}
        />
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            width: "100%",
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: "8px",
            boxShadow: "0 10px 25px -5px rgba(15, 23, 42, 0.12)",
            padding: "4px",
            zIndex: 50,
            display: "grid",
            gap: "2px",
            maxHeight: "220px",
            overflowY: "auto",
          }}
        >
          {options.map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                fontSize: "13px",
                background: value === opt.value ? "#f1f5f9" : "transparent",
                color: "#0f172a",
                fontWeight: value === opt.value ? 600 : 400,
                border: 0,
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
            <CustomSelect
              value={role}
              onChange={setRole}
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

          <div style={{ marginTop: "8px" }}>
            <label style={{ fontSize: "11px", fontWeight: 700, color: "#475569", letterSpacing: "0.5px" }}>
              MÉTHODE D'ACTIVATION DU COMPTE *
            </label>
            
            <div style={{ display: "flex", gap: "10px", marginTop: "8px", background: "#f8fafc", padding: "4px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
              <label style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "10px", background: activationMethod === "link" ? "#fff" : "transparent", borderRadius: "6px", cursor: "pointer", boxShadow: activationMethod === "link" ? "0 1px 2px rgba(0,0,0,0.05)" : "none", border: activationMethod === "link" ? "1px solid #cbd5e1" : "1px solid transparent", transition: "all 0.2s" }}>
                <input type="radio" name="activation" value="link" checked={activationMethod === "link"} onChange={() => setActivationMethod("link")} style={{ margin: 0, cursor: "pointer" }} />
                <span style={{ fontSize: "13px", fontWeight: activationMethod === "link" ? 600 : 500, color: activationMethod === "link" ? "#0f172a" : "#64748b" }}>Envoyer un lien</span>
              </label>
              
              <label style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "10px", background: activationMethod === "password" ? "#fff" : "transparent", borderRadius: "6px", cursor: "pointer", boxShadow: activationMethod === "password" ? "0 1px 2px rgba(0,0,0,0.05)" : "none", border: activationMethod === "password" ? "1px solid #cbd5e1" : "1px solid transparent", transition: "all 0.2s" }}>
                <input type="radio" name="activation" value="password" checked={activationMethod === "password"} onChange={() => setActivationMethod("password")} style={{ margin: 0, cursor: "pointer" }} />
                <span style={{ fontSize: "13px", fontWeight: activationMethod === "password" ? 600 : 500, color: activationMethod === "password" ? "#0f172a" : "#64748b" }}>Définir un mot de passe</span>
              </label>
            </div>
          </div>

          {activationMethod === "link" ? (
            <div style={{ padding: "12px 16px", background: "#e0f2fe", borderRadius: "8px", border: "1px solid #bae6fd", display: "flex", gap: "10px", alignItems: "flex-start", marginTop: "4px" }}>
              <CheckCheck size={18} style={{ color: "#0284c7", flexShrink: 0, marginTop: "2px" }} />
              <p style={{ margin: 0, fontSize: "12.5px", color: "#0369a1", lineHeight: 1.5 }}>
                Un e-mail d'invitation sera envoyé à <strong>{email || "l'utilisateur"}</strong> contenant un lien sécurisé pour qu'il définisse lui-même son propre mot de passe.
              </p>
            </div>
          ) : (
            <div className="stepper-field-group" style={{ marginTop: "4px" }}>
              <label htmlFor="password">MOT DE PASSE PROVISOIRE (Min. 8 caractères) *</label>
              <div className="input-wrap">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Saisissez un mot de passe sécurisé..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ borderColor: password.length > 0 && password.length < 8 ? "#ef4444" : "" }}
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
                <span style={{ fontSize: "11.5px", color: "#ef4444" }}>Le mot de passe doit contenir au moins 8 caractères.</span>
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