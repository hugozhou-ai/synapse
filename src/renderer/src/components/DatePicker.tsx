import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

const weekdays = ["一", "二", "三", "四", "五", "六", "日"] as const;

export function DatePicker({ value, onChange, ariaLabel }: {
  value: string;
  onChange(value: string): void;
  ariaLabel: string;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const today = startOfDay(new Date());
  const selected = parseDate(value);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => startOfMonth(selected ?? today));

  useEffect(() => {
    if (selected) setView(startOfMonth(selected));
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const selectDate = (date: Date) => {
    onChange(toDateValue(date));
    setView(startOfMonth(date));
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  return <div className={`date-picker ${open ? "open" : ""}`} ref={root} onKeyDown={handleKeyDown}>
    <button
      type="button"
      className="date-trigger"
      aria-label={ariaLabel}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? `${id}-calendar` : undefined}
      onClick={() => {
        setView(startOfMonth(selected ?? today));
        setOpen((current) => !current);
      }}
    ><span>{selected ? formatDisplayDate(selected) : "年 / 月 / 日"}</span><CalendarDays size={14} /></button>
    {open && <div className="date-popover" id={`${id}-calendar`} role="dialog" aria-label={`${ariaLabel}日历`}>
      <div className="date-header">
        <strong>{view.getFullYear()}年{view.getMonth() + 1}月</strong>
        <button type="button" aria-label="上个月" onClick={() => setView(addMonths(view, -1))}><ChevronLeft size={15} /></button>
        <button type="button" aria-label="下个月" onClick={() => setView(addMonths(view, 1))}><ChevronRight size={15} /></button>
      </div>
      <div className="date-weekdays" aria-hidden="true">{weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}</div>
      <div className="date-grid">
        {calendarDays(view).map((date) => {
          const dateValue = toDateValue(date);
          const isSelected = selected ? sameDay(date, selected) : false;
          return <button
            type="button"
            className={`date-day ${date.getMonth() === view.getMonth() ? "" : "outside"} ${sameDay(date, today) ? "today" : ""} ${isSelected ? "selected" : ""}`}
            aria-label={`${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`}
            aria-pressed={isSelected}
            aria-current={sameDay(date, today) ? "date" : undefined}
            key={dateValue}
            onClick={() => selectDate(date)}
          >{date.getDate()}</button>;
        })}
      </div>
      <div className="date-footer">
        <button type="button" disabled={!value} onClick={() => { onChange(""); setOpen(false); }}>清除</button>
        <button type="button" onClick={() => selectDate(today)}>今天</button>
      </div>
    </div>}
  </div>;
}

function parseDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function startOfDay(date: Date): Date { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function startOfMonth(date: Date): Date { return new Date(date.getFullYear(), date.getMonth(), 1); }
function addMonths(date: Date, amount: number): Date { return new Date(date.getFullYear(), date.getMonth() + amount, 1); }
function sameDay(left: Date, right: Date): boolean { return toDateValue(left) === toDateValue(right); }
function toDateValue(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function formatDisplayDate(date: Date): string { return `${date.getFullYear()} / ${String(date.getMonth() + 1).padStart(2, "0")} / ${String(date.getDate()).padStart(2, "0")}`; }

function calendarDays(view: Date): readonly Date[] {
  const mondayOffset = (view.getDay() + 6) % 7;
  const first = new Date(view.getFullYear(), view.getMonth(), 1 - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + index));
}
