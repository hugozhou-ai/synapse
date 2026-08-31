import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="page-header">
    <div className="page-title-block"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1></div>
    <div className="page-header-meta"><p>{description}</p>{actions && <div className="header-actions">{actions}</div>}</div>
  </header>;
}

export function ErrorBanner({ message }: { message: string }) {
  return <div className="error-banner" role="alert"><CircleAlert size={16} /><span>{message}</span></div>;
}

export function InfoBanner({ message }: { message: string }) {
  return <div className="info-banner" role="status"><CircleAlert size={16} /><span>{message}</span></div>;
}

export function EmptyState({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return <div className={`empty-state ${compact ? "compact" : ""}`}>{children}</div>;
}
