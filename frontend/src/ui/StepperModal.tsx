import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, X } from "./icons";
import "./stepper.css";

export interface StepItem {
  id: string;
  label: string;
  content: ReactNode;
  isValid?: () => boolean;
}

interface StepperModalProps {
  open: boolean;
  title: string;
  icon?: ReactNode;
  steps: StepItem[];
  submitLabel?: string;
  busy?: boolean;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
}

export function StepperModal({
  open,
  title,
  icon,
  steps,
  submitLabel = "Créer",
  busy = false,
  onClose,
  onSubmit,
}: StepperModalProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const lastFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    // Repart systématiquement de la première étape à chaque ouverture,
    // sinon une étape précédemment atteinte resterait affichée.
    setCurrentStep(0);

    lastFocused.current = document.activeElement as HTMLElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      lastFocused.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === steps.length - 1;
  const activeStep = steps[currentStep];

  const isCurrentStepValid = activeStep.isValid ? activeStep.isValid() : true;

  const handleNext = () => {
    if (!isCurrentStepValid) return;
    if (!isLastStep) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirstStep) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLastStep) {
      handleNext();
    } else {
      await onSubmit();
    }
  };

  return (
    <div
      className="stepper-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="stepper-modal" onClick={(e) => e.stopPropagation()}>
        <div className="stepper-header">
          <div className="stepper-header-title">
            {icon && <span className="stepper-header-icon">{icon}</span>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button type="button" className="stepper-close-btn" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>

        <div className="stepper-timeline" aria-label="Étapes de configuration">
          {steps.map((step, index) => {
            const isCompleted = index < currentStep;
            const isActive = index === currentStep;
            const isClickable = index < currentStep;

            return (
              <div
                key={step.id}
                className={`stepper-pill ${isActive ? "is-active" : ""} ${isCompleted ? "is-completed" : ""} ${isClickable ? "is-clickable" : ""}`}
                onClick={() => {
                  if (isClickable) {
                    setCurrentStep(index);
                  }
                }}
              >
                <div className="stepper-pill-circle">
                  {isCompleted ? <Check size={13} /> : index + 1}
                </div>
                <span className="stepper-pill-label">{step.label}</span>
                {index < steps.length - 1 && <span className="stepper-line" />}
              </div>
            );
          })}
        </div>

        <form onSubmit={handleFormSubmit} className="stepper-body">
          <div className="stepper-step-content">{activeStep.content}</div>

          <div className="stepper-footer">
            <button type="button" className="text-button cancel-btn" onClick={onClose}>
              Annuler
            </button>

            <div className="stepper-footer-actions">
              {!isFirstStep && (
                <button
                  type="button"
                  className="admin-button secondary"
                  onClick={handlePrev}
                  disabled={busy}
                >
                  Retour
                </button>
              )}

              {!isLastStep ? (
                /* CLÉ "next-btn" AJOUTÉE POUR ISOLER LE BOUTON */
                <button
                  key="next-btn"
                  type="button"
                  className="admin-button primary-cta"
                  onClick={handleNext}
                  disabled={!isCurrentStepValid}
                >
                  Suivant
                </button>
              ) : (
                /* CLÉ "submit-btn" AJOUTÉE POUR ISOLER LA SOUMISSION */
                <button
                  key="submit-btn"
                  type="submit"
                  className="admin-button primary-cta"
                  disabled={busy}
                >
                  {busy ? "Traitement en cours..." : submitLabel}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}