import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export function Select({ value, options, onChange, ariaLabel, disabled = false }: {
  value: string;
  options: readonly SelectOption[];
  onChange(value: string): void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(Math.max(selectedIndex, 0));
  const selected = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  useEffect(() => {
    if (selectedIndex >= 0) setActiveIndex(selectedIndex);
  }, [selectedIndex]);

  const move = (direction: 1 | -1) => {
    if (options.length === 0) return;
    let next = activeIndex;
    for (let traversed = 0; traversed < options.length; traversed += 1) {
      next = (next + direction + options.length) % options.length;
      if (!options[next]?.disabled) { setActiveIndex(next); return; }
    }
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    if (option.value !== value) onChange(option.value);
    setActiveIndex(index);
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
      } else move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setOpen(true);
      const indexes = options.map((_, index) => index).filter((index) => !options[index]?.disabled);
      setActiveIndex(event.key === "Home" ? indexes[0] ?? 0 : indexes.at(-1) ?? 0);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(activeIndex);
      else setOpen(true);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "Tab") setOpen(false);
  };

  return <div className={`select-control ${open ? "open" : ""}`} ref={root}>
    <button
      type="button"
      className="select-trigger"
      role="combobox"
      aria-label={ariaLabel}
      aria-expanded={open}
      aria-controls={open ? `${id}-listbox` : undefined}
      aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
      disabled={disabled}
      onClick={() => {
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
        setOpen((current) => !current);
      }}
      onKeyDown={handleKeyDown}
    >
      <span className="select-value">{selected?.label ?? (value || "—")}</span>
      <span className="select-indicator"><ChevronDown className="select-chevron" size={14} /></span>
    </button>
    {open && <div className="select-menu" id={`${id}-listbox`} role="listbox" aria-label={ariaLabel}>
      {options.map((option, index) => <button
        type="button"
        id={`${id}-option-${index}`}
        className={`select-option ${index === activeIndex ? "active" : ""}`}
        role="option"
        aria-selected={option.value === value}
        disabled={option.disabled}
        key={option.value}
        onPointerEnter={() => setActiveIndex(index)}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => choose(index)}
      ><span>{option.label}</span>{option.value === value && <Check size={13} />}</button>)}
    </div>}
  </div>;
}
