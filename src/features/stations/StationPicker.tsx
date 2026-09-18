import { useState, useMemo, useEffect } from "react";
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
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      setQuery("");
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const modalContent = isOpen ? (
    <div className="stepper-overlay station-picker-overlay" onClick={() => setIsOpen(false)}>
      <div className="station-picker-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="station-picker-title">Choisir une station</h2>
            <p className="modal-subtitle">Sélectionnez la station d'affectation</p>
          </div>
          <button type="button" className="modal-close" onClick={() => setIsOpen(false)}>
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
        type="button"
        className="station-picker-trigger"
        onClick={() => setIsOpen(true)}
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
