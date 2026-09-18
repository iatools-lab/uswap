import { useState, useMemo, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Building2, Search, X, MapPin } from "../../ui/icons";
import { CaretDownIcon } from "@phosphor-icons/react";
import "./station-picker.css";

interface Station {
  id: string;
  name: string;
  city?: string | null;
  address?: string | null;
}

interface StationPickerProps {
  value: string;
  stations: Station[];
  onChange: (id: string) => void;
  placeholder?: string;
  allowEmpty?: boolean;
}

export function StationPicker({
  value,
  stations,
  onChange,
  placeholder = "Sélectionner une station (Optionnel)",
  allowEmpty = true,
}: StationPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const selectedStation = stations.find((s) => s.id === value);

  const filteredStations = useMemo(() => {
    if (!query) return stations;
    return stations.filter((s) =>
      s.name.toLowerCase().includes(query.toLowerCase()) ||
      (s.city && s.city.toLowerCase().includes(query.toLowerCase()))
    );
  }, [stations, query]);

  const handleSelect = (id: string) => {
    onChange(id);
    setIsOpen(false);
    setQuery("");
  };

  // Bloque le défilement de la page quand le modal est ouvert
  // et repart d'une recherche vierge à chaque ouverture.
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      setQuery("");
    };
  }, [isOpen]);

  const modalContent = isOpen ? (
    <div
      className="stepper-overlay station-picker-overlay"
      onClick={() => setIsOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div ref={panelRef} className="station-picker-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 id={titleId} className="station-picker-title">Choisir une station</h2>
            <p className="modal-subtitle">Sélectionnez la station d'affectation</p>
          </div>
          <button type="button" className="modal-close" onClick={() => setIsOpen(false)} aria-label="Fermer la liste des stations">
            <X size={18} />
          </button>
        </div>

        <div className="station-picker-search">
          <div className="station-picker-search-field">
            <Search size={16} className="station-picker-search-icon" />
            <input
              autoFocus
              placeholder="Rechercher par nom ou ville..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="modal-body station-picker-list">
          {allowEmpty && (
            <button
              type="button"
              className={`station-picker-option is-none${value === "" ? " is-selected" : ""}`}
              onClick={() => handleSelect("")}
            >
              <span className={`station-picker-option-none-label${value === "" ? " is-selected" : ""}`}>
                Aucune station (Optionnel)
              </span>
            </button>
          )}

          {filteredStations.map((station) => (
            <button
              key={station.id}
              type="button"
              className={`station-picker-option${value === station.id ? " is-selected" : ""}`}
              onClick={() => handleSelect(station.id)}
            >
              <strong>{station.name}</strong>
              {(station.city || station.address) && (
                <span className="station-picker-location">
                  <MapPin size={12} />
                  {station.city ? `${station.city} ` : ""}{station.address ? `- ${station.address}` : ""}
                </span>
              )}
            </button>
          ))}

          {filteredStations.length === 0 && (
            <div className="station-picker-empty">
              Aucune station ne correspond à "{query}"
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="station-picker-trigger"
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <span className={`station-picker-trigger-label${selectedStation ? " has-value" : ""}`}>
          <Building2 size={16} />
          <span className="station-picker-trigger-name">
            {selectedStation ? selectedStation.name : placeholder}
          </span>
        </span>
        <CaretDownIcon size={14} className="station-picker-caret" />
      </button>

      {isOpen && typeof document !== "undefined" && createPortal(modalContent, document.body)}
    </>
  );
}
