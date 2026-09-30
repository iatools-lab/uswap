import { useEffect, useId, useRef, useState } from "react";

export function SwapperContact({ person, onChange, disabled }: {
  person: { fullName: string; email: string; phoneNumber: string | null };
  onChange?: () => void;
  disabled: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const cancel = () => clearTimeout(timer.current);
  function close() { cancel(); card.current?.hidePopover(); setOpen(false); }
  function show() {
    cancel();
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect || !card.current) return;
    card.current.showPopover();
    const width = card.current.offsetWidth;
    const height = card.current.offsetHeight;
    card.current.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
    card.current.style.top = `${rect.bottom + height + 12 < innerHeight ? rect.bottom + 6 : Math.max(12, rect.top - height - 6)}px`;
    setOpen(true);
  }
  function leave() {
    cancel();
    timer.current = setTimeout(() => {
      if (!card.current?.contains(document.activeElement) && document.activeElement !== trigger.current) close();
    }, 160);
  }
  useEffect(() => {
    const dismiss = () => close();
    window.addEventListener("resize", dismiss);
    return () => { clearTimeout(timer.current); window.removeEventListener("resize", dismiss); };
  }, []);
  return <>
    <button type="button" ref={trigger} className="day-roster-name" aria-expanded={open} aria-controls={id}
      onMouseEnter={show} onMouseLeave={leave} onFocus={show} onBlur={leave} onClick={show}>
      {person.fullName}
    </button>
    <div id={id} ref={card} popover="auto" className="day-contact-popover" onToggle={e => setOpen(e.newState === "open")}
      onMouseEnter={cancel} onMouseLeave={leave} onFocus={cancel} onBlur={leave}>
      <strong>{person.fullName}</strong>
      <a href={`mailto:${person.email}`}>{person.email}</a>
      {person.phoneNumber ? <a href={`tel:${person.phoneNumber}`}>{person.phoneNumber}</a> : <span>Téléphone non renseigné</span>}
      {onChange && <button type="button" className="text-button" disabled={disabled} onClick={() => { close(); onChange(); }}>Changer l’affectation</button>}
    </div>
  </>;
}
