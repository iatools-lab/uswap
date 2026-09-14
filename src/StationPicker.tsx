import { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { Building2, Search, X, MapPin } from "./icons";
import { CaretDownIcon } from "@phosphor-icons/react";

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
}

export function StationPicker({
  value,
  stations,
  onChange,
  placeholder = "Sélectionner une station (Optionnel)",
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
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const modalContent = isOpen ? (
    <div className="stepper-overlay" onClick={() => setIsOpen(false)} style={{ zIndex: 99999, padding: "24px" }}>
      <div 
        className="modal-panel" 
        onClick={(e) => e.stopPropagation()} 
        style={{ maxWidth: "480px", maxHeight: "75vh", width: "100%", margin: "auto", borderRadius: "16px", display: "flex", flexDirection: "column" }}
      >
        <div className="modal-header">
          <div>
            <h2 style={{ fontSize: "16px" }}>Choisir une station</h2>
            <p className="modal-subtitle">Sélectionnez la station d'affectation</p>
          </div>
          <button type="button" className="modal-close" onClick={() => setIsOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: "16px", borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ position: "relative" }}>
            <Search size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#64748b" }} />
            <input
              autoFocus
              placeholder="Rechercher par nom ou ville..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{
                width: "100%",
                height: "40px",
                paddingLeft: "36px",
                paddingRight: "14px",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
                fontSize: "13.5px",
                outline: "none"
              }}
            />
          </div>
        </div>

        <div className="modal-body" style={{ padding: "0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
          <button
            type="button"
            onClick={() => handleSelect("")}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "16px",
              borderBottom: "1px solid #f1f5f9",
              background: value === "" ? "#f8fafc" : "transparent",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
              width: "100%"
            }}
          >
            <span style={{ fontWeight: value === "" ? 600 : 400, color: "#64748b" }}>Aucune station (Optionnel)</span>
          </button>

          {filteredStations.map((station) => (
            <button
              key={station.id}
              type="button"
              onClick={() => handleSelect(station.id)}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                padding: "16px",
                borderBottom: "1px solid #f1f5f9",
                background: value === station.id ? "#f0f9ff" : "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                width: "100%",
                transition: "background 0.2s"
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = value === station.id ? "#f0f9ff" : "#f8fafc")}
              onMouseLeave={(e) => (e.currentTarget.style.background = value === station.id ? "#f0f9ff" : "transparent")}
            >
              <strong style={{ fontSize: "14px", color: value === station.id ? "#0284c7" : "#0f172a" }}>
                {station.name}
              </strong>
              {(station.city || station.address) && (
                <span style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: "#64748b" }}>
                  <MapPin size={12} />
                  {station.city ? `${station.city} ` : ""}{station.address ? `- ${station.address}` : ""}
                </span>
              )}
            </button>
          ))}

          {filteredStations.length === 0 && (
            <div style={{ padding: "32px", textAlign: "center", color: "#64748b", fontSize: "13.5px" }}>
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
        onClick={() => setIsOpen(true)}
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
        <span style={{ display: "flex", alignItems: "center", gap: "8px", color: selectedStation ? "inherit" : "#94a3b8" }}>
          <Building2 size={16} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {selectedStation ? selectedStation.name : placeholder}
          </span>
        </span>
        <CaretDownIcon size={14} style={{ color: "#64748b", flexShrink: 0 }} />
      </button>

      {isOpen && typeof document !== "undefined" && createPortal(modalContent, document.body)}
    </>
  );
}