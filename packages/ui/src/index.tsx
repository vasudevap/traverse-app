import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

/** Bearing tokens (50-design/design-system.md). */
export const tokens = {
  surface: '#FAFBFC',
  surfacePanel: '#F0F5FA',
  surfaceEditorial: '#FBF8F2',
  surfaceTrust: '#11283F',
  text: '#1A3C5E',
  textSecondary: '#5A7A9A',
  accent: '#2E8B7A',
  accentStrong: '#1D6B5C',
  mark: '#E8A020',
  markText: '#9A6A12',
  line: '#D0E2F0',
  danger: '#C0392B',
} as const;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'line' | 'quiet';
};

/** A clearly ranked action. Use one primary action per view. */
export function Button({ className = '', variant = 'primary', ...props }: ButtonProps) {
  return <button className={`trv-button trv-button--${variant} ${className}`} {...props} />;
}

export type CardProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  tone?: 'default' | 'editorial' | 'trust';
};

export function Card({ children, className = '', tone = 'default', ...props }: CardProps) {
  return (
    <section className={`trv-card trv-card--${tone} ${className}`} {...props}>
      {children}
    </section>
  );
}

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  tone?: 'accent' | 'mark' | 'neutral' | 'danger';
};

export function Badge({ children, className = '', tone = 'neutral', ...props }: BadgeProps) {
  return (
    <span className={`trv-badge trv-badge--${tone} ${className}`} {...props}>
      {children}
    </span>
  );
}

export type FieldProps = HTMLAttributes<HTMLLabelElement> & {
  children: ReactNode;
  hint?: ReactNode;
  label: ReactNode;
};

export function Field({ children, className = '', hint, label, ...props }: FieldProps) {
  return (
    <label className={`trv-field ${className}`} {...props}>
      <span className="trv-field__label">{label}</span>
      {children}
      {hint ? <span className="trv-field__hint">{hint}</span> : null}
    </label>
  );
}

export function TextInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`trv-input ${className}`} {...props} />;
}

export type NavigationItem = {
  current?: boolean;
  href: string;
  label: string;
};

export function Navigation({ items }: { items: NavigationItem[] }) {
  return (
    <nav className="trv-nav">
      {items.map(({ current, href, label }) => (
        <a
          aria-current={current ? 'page' : undefined}
          className={`trv-nav__item${current ? ' trv-nav__item--current' : ''}`}
          href={href}
          key={label}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

export type AppShellProps = {
  children: ReactNode;
  navigation?: NavigationItem[];
  productName: string;
  roleLabel: string;
};

/** Structural role boundary: each app renders only its own role navigation. */
export function AppShell({ children, navigation = [], productName, roleLabel }: AppShellProps) {
  return (
    <div className="trv-shell">
      <header className="trv-shell__mobile-header">
        <span className="trv-wordmark">Traverse</span>
        <Badge tone="accent">{roleLabel}</Badge>
      </header>
      <aside className="trv-sidebar" aria-label={`${productName} navigation`}>
        <div className="trv-sidebar__brand">
          <span className="trv-wordmark">Traverse</span>
          <span className="trv-sidebar__product">{productName}</span>
        </div>
        <Navigation items={navigation} />
        <Badge tone="neutral">{roleLabel}</Badge>
      </aside>
      <main className="trv-main">{children}</main>
    </div>
  );
}

export type PageHeaderProps = {
  actions?: ReactNode;
  eyebrow?: ReactNode;
  summary?: ReactNode;
  title: ReactNode;
};

export function PageHeader({ actions, eyebrow, summary, title }: PageHeaderProps) {
  return (
    <header className="trv-page-header">
      <div>
        {eyebrow ? <div className="trv-eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {summary ? <p>{summary}</p> : null}
      </div>
      {actions ? <div className="trv-page-header__actions">{actions}</div> : null}
    </header>
  );
}

export type TileRowProps = {
  action?: ReactNode;
  children?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
};

export function TileRow({ action, children, description, title }: TileRowProps) {
  return (
    <div className="trv-tile-row">
      <div className="trv-tile-row__content">
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
        {children}
      </div>
      {action ? <div className="trv-tile-row__action">{action}</div> : null}
    </div>
  );
}

export type EmptyStateProps = {
  action?: ReactNode;
  children?: ReactNode;
  title: ReactNode;
};

export function EmptyState({ action, children, title }: EmptyStateProps) {
  return (
    <section className="trv-empty-state">
      <div className="trv-empty-state__mark" aria-hidden="true">
        ◌
      </div>
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
      {action ? <div>{action}</div> : null}
    </section>
  );
}
