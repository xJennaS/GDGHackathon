import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text';

export function Button({
  variant = 'filled',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button className={`ui-button ui-button-${variant} ${className}`} {...props} />;
}

export function IconButton({ label, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className={`ui-icon-button ${className}`} aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}

export function Chip({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`ui-chip ${className}`} {...props}>{children}</button>;
}

export function Card({ children, className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return <article className={`ui-card ${className}`} {...props}>{children}</article>;
}

export function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'running' | 'success' | 'error' }) {
  return <span className={`status-pill status-${tone}`}><span className="status-dot" aria-hidden="true" />{children}</span>;
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange(value: T): void;
}) {
  return (
    <div className="segmented-control" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={value === option.value ? 'segment selected' : 'segment'}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange(checked: boolean): void }) {
  return (
    <button type="button" className="ui-switch" role="switch" aria-label={label} aria-checked={checked} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return <span className="tooltip" data-tooltip={label}>{children}</span>;
}

export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose(): void }) {
  return (
    <div className="dialog-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dialog-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header className="sheet-header">
          <h2>{title}</h2>
          <IconButton label="Close settings" onClick={onClose}>×</IconButton>
        </header>
        {children}
      </section>
    </div>
  );
}

export function Drawer({ title, children, onClose }: { title: string; children: ReactNode; onClose(): void }) {
  return (
    <div className="drawer-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="drawer" aria-label={title}>
        <header className="sheet-header">
          <h2>{title}</h2>
          <IconButton label={`Close ${title.toLowerCase()}`} onClick={onClose}>×</IconButton>
        </header>
        {children}
      </aside>
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function Icon({ name }: { name: 'sparkle' | 'source' | 'activity' | 'settings' | 'mic' | 'send' | 'stop' | 'mail' | 'calendar' | 'table' | 'shield' | 'error' }) {
  const paths: Record<typeof name, ReactNode> = {
    sparkle: <path d="M12 2.8 14.6 9.4 21.2 12l-6.6 2.6L12 21.2l-2.6-6.6L2.8 12l6.6-2.6L12 2.8Z" />,
    source: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4M8.5 11h5M11 8.5v5" /></>,
    activity: <><path d="M3 12h4l2.2-6 4.1 12 2.2-6H21" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.8 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.8-1l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.8-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.8 1l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 2Z" /></>,
    mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
    send: <><path d="m4 12 16-8-5 16-3-7-8-1Z" /><path d="m12 13 4-4" /></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18" /></>,
    table: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 10v10m6-10v10" /></>,
    shield: <><path d="M12 3 19 6v5c0 4.5-3 7.7-7 10-4-2.3-7-5.5-7-10V6l7-3Z" /><path d="m9 12 2 2 4-4" /></>,
    error: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 4h.01" /></>,
  };
  return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
