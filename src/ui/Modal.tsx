import { useEffect, useRef, useId, type ReactNode } from 'react';
import { XIcon } from '@phosphor-icons/react';
import './modal.css';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional small text under the title, e.g. a date range or station name */
  subtitle?: string;
  children: ReactNode;
  /** Footer actions, e.g. <button>Annuler</button><button>Enregistrer</button> */
  footer?: ReactNode;
  size?: "md" | "lg" | "xl";
};

/**
 * Mobile-first modal: renders as a bottom sheet under 640px, and as a
 * centered dialog above that. Closes on Escape, overlay click, or the
 * close button. Locks background scroll while open.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "md",
}: ModalProps) {
  const panelRef = useRef<HTMLDialogElement>(null);
  const titleId=useId();
  const closeRef=useRef(onClose);closeRef.current=onClose;
  const lastFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    lastFocused.current = document.activeElement as HTMLElement;
    panelRef.current?.showModal();
    requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLElement>(
          '.modal-body [autofocus], .modal-body input:not(:disabled), .modal-body select:not(:disabled), .modal-body textarea:not(:disabled), .modal-body button:not(:disabled), .modal-footer button:not(:disabled), .modal-close',
        )
        ?.focus();
    });

    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      panelRef.current?.close();
      document.body.style.overflow = previousOverflow;
      lastFocused.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
      <dialog
        className={`modal-panel modal-panel--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={panelRef}
        onCancel={e=>{e.preventDefault();e.stopPropagation();closeRef.current();}}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeRef.current();
        }}
      >
        <div className="modal-drag-handle" aria-hidden="true" />

        <div className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p className="modal-subtitle">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Fermer la fenêtre"
          >
            <XIcon size={20} weight="bold" />
          </button>
        </div>

        <div className="modal-body">{children}</div>

        {footer && <div className="modal-footer">{footer}</div>}
      </dialog>
  );
}
