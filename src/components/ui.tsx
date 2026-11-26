import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { IconX } from './icons';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/* ---- Buttons ---- */
export type BtnVariant = 'primary' | 'secondary' | 'danger' | 'dangerSolid' | 'sidebar';

const BTN_BASE =
  'inline-flex items-center gap-[7px] border border-solid rounded-[3px] font-semibold whitespace-nowrap no-underline disabled:opacity-45 disabled:cursor-not-allowed';
const BTN_VARIANT: Record<BtnVariant, string> = {
  primary: 'bg-btn border-btn text-btn-fg',
  secondary: 'bg-transparent border-line text-ink',
  danger: 'bg-transparent border-terracotta text-terracotta',
  dangerSolid: 'bg-terracotta border-terracotta text-white',
  sidebar: 'bg-transparent border-white/25 text-[#D9D5C8]',
};

export function btnClass(variant: BtnVariant = 'primary', small = false, extra = ''): string {
  return cx(BTN_BASE, small ? 'px-[10px] py-[5px] text-[12.5px]' : 'px-[15px] py-[9px] text-[13.5px]', BTN_VARIANT[variant], extra);
}

export function Btn({ variant = 'primary', small = false, className = '', type = 'button', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; small?: boolean }) {
  return <button type={type} className={btnClass(variant, small, className)} {...rest} />;
}

export function BtnRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={cx('flex gap-2 flex-wrap', className)}>{children}</div>;
}

export function RowActions({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={cx('flex gap-[6px] flex-wrap', className)}>{children}</div>;
}

/* ---- Status pill ---- */
const PILL: Record<string, string> = {
  occupied: 'bg-sage-soft text-sage',
  vacant: 'bg-line text-ink-soft',
  reserved: 'bg-teal-soft text-teal',
  maintenance: 'bg-amber-soft text-amber',
  paid: 'bg-sage-soft text-sage',
  partial: 'bg-teal-soft text-teal',
  unpaid: 'bg-amber-soft text-amber',
  overdue: 'bg-terracotta-soft text-terracotta',
  // reservations (0012)
  pending: 'bg-amber-soft text-amber',
  confirmed: 'bg-teal-soft text-teal',
  cancelled: 'bg-line text-ink-soft',
  expired: 'bg-line text-ink-soft',
  moved_in: 'bg-sage-soft text-sage',
  // maintenance tickets (0012)
  open: 'bg-amber-soft text-amber',
  in_progress: 'bg-teal-soft text-teal',
  done: 'bg-sage-soft text-sage',
  urgent: 'bg-terracotta-soft text-terracotta',
};
export function Pill({ status, children, className = '' }: { status: string; children: ReactNode; className?: string }) {
  return <span className={cx('inline-block px-[10px] py-[3px] rounded-[20px] text-[11.5px] font-semibold', PILL[status], className)}>{children}</span>;
}

/* ---- Page structure ---- */
export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <>
      <div className="flex justify-between items-end gap-4 mb-[22px] flex-wrap">
        <div>
          <h1 className="text-[26px] mt-0 mb-1">{title}</h1>
          {sub !== undefined && <div className="text-muted text-[13.5px]">{sub}</div>}
        </div>
        {children}
      </div>
      <div className="h-px bg-line mb-[26px]" />
    </>
  );
}

export function Panel({ children, flush = false, className = '' }: { children: ReactNode; flush?: boolean; className?: string }) {
  return <div className={cx('bg-paper-raised border border-line rounded mb-[22px]', flush ? 'p-0' : 'p-[22px]', className)}>{children}</div>;
}

export function PanelTitle({ children, className = 'mt-0 mb-1' }: { children: ReactNode; className?: string }) {
  return <h2 className={cx('text-base', className)}>{children}</h2>;
}

export function Desc({ children, className = 'mt-0 mb-4' }: { children: ReactNode; className?: string }) {
  return <p className={cx('text-muted text-[13px]', className)}>{children}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-[30px] px-[10px] text-center text-muted text-[13.5px]">{children}</div>;
}

export function AlertBar({ kind, children }: { kind: 'warn' | 'info'; children: ReactNode }) {
  return (
    <div className={cx(
      'flex items-center gap-[10px] px-[14px] py-3 rounded text-[13.5px] mb-[14px] border',
      kind === 'warn' ? 'bg-terracotta-soft border-terracotta text-terracotta' : 'bg-teal-soft border-teal text-teal',
    )}>{children}</div>
  );
}

/* ---- Stats strip ---- */
export function Stats({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-4 max-[760px]:grid-cols-2 border border-line rounded overflow-hidden mb-7">{children}</div>;
}
export function Stat({ label, value, foot, valueClass = '', valueStyle }: {
  label: ReactNode; value: ReactNode; foot?: ReactNode; valueClass?: string; valueStyle?: CSSProperties;
}) {
  return (
    <div className="px-5 py-[18px] border-r border-line last:border-r-0 max-[760px]:border-b bg-paper-raised">
      <div className="text-[11.5px] uppercase tracking-[0.06em] text-muted mb-2">{label}</div>
      <div className={cx('font-display text-[27px] font-semibold tabular-nums', valueClass)} style={valueStyle}>{value}</div>
      {foot !== undefined && <div className="text-xs text-muted mt-1">{foot}</div>}
    </div>
  );
}

/* ---- Forms ---- */
export function Field({ label, hint, children, className = '' }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-[5px]', className)}>
      <label className="text-xs text-muted font-semibold">{label}</label>
      {children}
      {hint !== undefined && <span className="text-[11px] text-muted font-normal">{hint}</span>}
    </div>
  );
}

export function FormGrid({ children, className = 'mb-4' }: { children: ReactNode; className?: string }) {
  return <div className={cx('grid grid-cols-3 max-[760px]:grid-cols-2 max-[520px]:grid-cols-1 gap-[14px]', className)}>{children}</div>;
}

/* ---- Tables ---- */
export function DataTable({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-[13.5px]">{children}</table>
    </div>
  );
}

export const Muted = ({ children }: { children: ReactNode }) => <span className="text-muted">{children}</span>;
export const Dash = () => <span className="text-muted">—</span>;

/* ---- Modal ---- */
export function Modal({ onClose, children, className = 'max-w-[460px]' }: { onClose: () => void; children: ReactNode; className?: string }) {
  return (
    <div
      className="fixed inset-0 bg-[rgba(20,18,14,0.55)] flex items-start justify-center px-4 py-9 overflow-y-auto z-[80]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={cx('bg-paper-raised rounded-[5px] w-full p-[26px] border border-line', className)}>{children}</div>
    </div>
  );
}

export function ModalClose({ onClick }: { onClick: () => void }) {
  return <button type="button" aria-label="Close" className="float-right bg-transparent border-0 text-muted p-1 -m-1" onClick={onClick}><IconX size={20} /></button>;
}
