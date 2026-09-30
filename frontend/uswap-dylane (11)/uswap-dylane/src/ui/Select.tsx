import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  disabled?: boolean;
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
  disabled = false,
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const [menuPosition, setMenuPosition] = useState({
    left: 0,
    top: 0,
    width: 0,
    maxHeight: 220,
  });

  useEffect(() => {
    const handleOutsideClick = (event: globalThis.MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      )
        setIsOpen(false);
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

  useLayoutEffect(() => {
    if (!isOpen) return;
    const updatePosition = () => {
      const trigger = ref.current?.getBoundingClientRect();
      if (!trigger) return;
      const viewportPadding = 12;
      const availableBelow =
        window.innerHeight - trigger.bottom - viewportPadding;
      const availableAbove = trigger.top - viewportPadding;
      const openAbove = availableBelow < 180 && availableAbove > availableBelow;
      const maxHeight = Math.max(
        120,
        Math.min(260, openAbove ? availableAbove - 6 : availableBelow - 6),
      );
      setMenuPosition({
        left: Math.max(
          viewportPadding,
          Math.min(
            trigger.left,
            window.innerWidth - trigger.width - viewportPadding,
          ),
        ),
        top: openAbove
          ? Math.max(
              viewportPadding,
              trigger.top - Math.min(220, maxHeight) - 6,
            )
          : trigger.bottom + 6,
        width: trigger.width,
        maxHeight,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen]);

  const selectedOption = options.find((option) => option.value === value);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const portalTarget = ref.current?.closest("dialog") ?? document.body;

  function openAt(index: number) {
    const next = Math.max(0, Math.min(options.length - 1, index));
    setActiveIndex(next);
    setIsOpen(true);
    requestAnimationFrame(() => optionRefs.current[next]?.focus());
  }

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setIsOpen(false);
    ref.current
      ?.querySelector<HTMLButtonElement>(".ui-select__trigger")
      ?.focus();
  }

  return (
    <div
      ref={ref}
      className={`ui-select ui-select--${size}`}
      style={{ width, minWidth }}
    >
      <button
        type="button"
        className="ui-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (isOpen) setIsOpen(false);
          else openAt(selectedIndex >= 0 ? selectedIndex : 0);
        }}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const index =
              event.key === "End"
                ? options.length - 1
                : event.key === "ArrowUp"
                  ? selectedIndex > 0
                    ? selectedIndex - 1
                    : options.length - 1
                  : 0;
            openAt(index);
          }
        }}
      >
        <span
          className={`ui-select__value${selectedOption ? "" : " ui-select__value--placeholder"}`}
        >
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <CaretDownIcon
          size={14}
          className={`ui-select__caret${isOpen ? " ui-select__caret--open" : ""}`}
        />
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={menuRef}
            className="ui-select__menu ui-select__menu--portal"
            id={listboxId}
            role="listbox"
            style={{
              left: menuPosition.left,
              top: menuPosition.top,
              width: menuPosition.width,
              minWidth: menuMinWidth,
              maxHeight: menuPosition.maxHeight,
            }}
          >
            {options.map((option, index) => (
              <button
                key={String(option.value)}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`ui-select__option${option.value === value ? " ui-select__option--selected" : ""}`}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                tabIndex={index === activeIndex ? 0 : -1}
                onClick={() => choose(index)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setIsOpen(false);
                    ref.current
                      ?.querySelector<HTMLButtonElement>(".ui-select__trigger")
                      ?.focus();
                  } else if (
                    event.key === "ArrowDown" ||
                    event.key === "ArrowUp"
                  ) {
                    event.preventDefault();
                    const delta = event.key === "ArrowDown" ? 1 : -1;
                    const next =
                      (index + delta + options.length) % options.length;
                    setActiveIndex(next);
                    optionRefs.current[next]?.focus();
                  } else if (event.key === "Home" || event.key === "End") {
                    event.preventDefault();
                    const next = event.key === "Home" ? 0 : options.length - 1;
                    setActiveIndex(next);
                    optionRefs.current[next]?.focus();
                  } else if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    choose(index);
                  }
                }}
              >
                {option.label}
              </button>
            ))}
          </div>,
          portalTarget,
        )}
    </div>
  );
}
