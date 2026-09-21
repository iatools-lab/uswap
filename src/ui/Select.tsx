import { useEffect, useRef, useState } from "react";
import { CaretDownIcon } from "@phosphor-icons/react";
import "./ui.css";

export type SelectValue = string | number;

export type SelectOption = { label: string; value: SelectValue };

export type SelectSize = "sm" | "md" | "lg";

interface SelectProps {
  value: SelectValue;
  options: SelectOption[];
  onChange: (value: SelectValue) => void;
  placeholder?: string;
  /** Largeur du contrôle (ex. "auto", "100%", "240px"). */
  width?: string;
  /** Gabarit : sm = barre d'outils, md = formulaires, lg = saisie guidée. */
  size?: SelectSize;
  minWidth?: string;
  menuMinWidth?: string;
  ariaLabel?: string;
}

/**
 * Select unique du design system uSwap.
 * Remplace les implémentations ad hoc (AdminWorkspace, UsersPage, UserDetail).
 */
export function Select({
  value,
  options,
  onChange,
  placeholder = "Sélectionner",
  width = "100%",
  size = "md",
  minWidth,
  menuMinWidth,
  ariaLabel,
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (event: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const selectedOption = options.find((option) => option.value === value);

  return (
    <div ref={ref} className={`ui-select ui-select--${size}`} style={{ width, minWidth }}>
      <button
        type="button"
        className="ui-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className={`ui-select__value${selectedOption ? "" : " ui-select__value--placeholder"}`}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <CaretDownIcon size={14} className={`ui-select__caret${isOpen ? " ui-select__caret--open" : ""}`} />
      </button>

      {isOpen && (
        <div
          className="ui-select__menu"
          role="listbox"
          style={menuMinWidth ? { minWidth: menuMinWidth } : undefined}
        >
          {options.map((option) => (
            <button
              key={String(option.value)}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={`ui-select__option${option.value === value ? " ui-select__option--selected" : ""}`}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}