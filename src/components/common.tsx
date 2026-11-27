import type { ReactNode } from 'react';
import type { NotifyResult } from '../lib/api';
import { friendlyError, useI18n, type TKey } from '../lib/i18n';
import { AlertBar, Btn, Empty, Pill } from './ui';

/** Toast after a confirm: adds whether the guest got the LINE message (nothing extra if not on LINE). */
export function confirmToast(ok: string, r: NotifyResult | null, t: (k: TKey) => string): [string, 'ok' | 'error'] {
  if (!r || r.reason === 'NO_LINE' || r.reason === 'NOT_CONFIRMED') return [ok, 'ok'];
  return r.pushed ? [`${ok} · ${t('notify.sent')}`, 'ok'] : [`${ok} · ${t('notify.failed')}`, 'error'];
}

/** Coloured pill with the translated status name. */
export function StatusPill({ status }: { status: string | null | undefined }) {
  const { t } = useI18n();
  const s = status ?? 'unpaid';
  return <Pill status={s}>{t(`status.${s}` as TKey)}</Pill>;
}

/** Shows loading / error (with retry) / the content. */
export function LoadState({ loading, error, onRetry, children }: {
  loading: boolean; error: unknown; onRetry?: () => void; children: ReactNode;
}) {
  const { t } = useI18n();
  if (error) {
    return (
      <AlertBar kind="warn">
        <span className="flex-1">{t('err.load')} {friendlyError(error, t)}</span>
        {onRetry && <Btn small variant="secondary" onClick={onRetry}>{t('common.retry')}</Btn>}
      </AlertBar>
    );
  }
  if (loading) return <Empty>{t('common.loading')}</Empty>;
  return <>{children}</>;
}

/** A labelled number input sized for thumbs. */
export function NumInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" inputMode="decimal" autoComplete="off" {...props} />;
}
