import { useNavigate, useParams } from 'react-router';
import { getReceipt } from '../lib/api';
import { meter } from '../lib/format';
import { useI18n, type TKey } from '../lib/i18n';
import { useLoad } from '../lib/useLoad';
import { LoadState } from '../components/common';
import { IconPrinter } from '../components/icons';
import { Btn, BtnRow, Empty } from '../components/ui';

/** Printable receipt for one payment. Uses the browser's print (or "Save as PDF"). */
export default function Receipt() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { t, money, date, month } = useI18n();
  const { data, error, loading, reload } = useLoad(() => getReceipt(id), [id]);

  const line = (label: string, amount: number | null | undefined, strong = false) => (
    <div className={`flex justify-between gap-4 py-1 ${strong ? 'font-semibold' : ''}`}>
      <span>{label}</span><span className="tabular-nums">{money(amount)}</span>
    </div>
  );

  return (
    <LoadState loading={loading && !data} error={error} onRetry={reload}>
      {data === null ? <Empty>{t('receipt.not_found')}</Empty> : data && (() => {
        const { payment: p, bill: b, extras, settings } = data;
        return (
          <>
            <BtnRow className="no-print mb-4">
              <Btn variant="secondary" onClick={() => navigate(-1)}>{t('common.back')}</Btn>
              <Btn onClick={() => window.print()}><IconPrinter size={17} />{t('receipt.print')}</Btn>
            </BtnRow>
            <div className="print-area bg-white text-black border border-line rounded max-w-[560px] p-6 sm:p-8 text-[14px]">
              <div className="text-center mb-5">
                <div className="font-display text-xl font-semibold">{settings.dorm_name}</div>
                <div className="text-[18px] font-semibold mt-1">{t('receipt.title')}</div>
              </div>
              <div className="flex justify-between gap-4 flex-wrap mb-4">
                <div>{t('receipt.no')} <strong className="tabular-nums">{p.receipt_no}</strong></div>
                <div>{t('receipt.date')} <strong>{date(p.paid_on)}</strong></div>
              </div>
              <div className="mb-1">{t('receipt.received_from')} <strong>{b.tenant_name || '—'}</strong></div>
              <div className="mb-4">{t('receipt.for', { n: b.room_number ?? '', month: month(b.month) })}</div>

              <div className="border-t border-b border-black/30 py-2 mb-2">
                <div className="text-[12px] uppercase tracking-wide text-black/60 mb-1">{t('receipt.items')}</div>
                {line(t('common.rent'), b.rent)}
                {line(t('billing.water_line', { n: b.water_people ?? 0, r: money(b.water_per_person) }), b.water_amount)}
                {line(`${t('billing.elec_line', { u: meter(b.elec_units), r: money(b.elec_rate) })} (${meter(b.elec_prev)} → ${meter(b.elec_curr)})`, b.elec_amount)}
                {extras.map((x) => <div key={x.id}>{line(x.label, x.amount)}</div>)}
                {line(t('receipt.bill_total'), b.total, true)}
              </div>
              {data.paidBefore > 0 && line(t('receipt.paid_before'), data.paidBefore)}
              <div className="flex justify-between gap-4 py-2 text-[17px] font-semibold border-b border-black/30">
                <span>{t('receipt.this_payment')}</span><span className="tabular-nums">{money(p.amount)}</span>
              </div>
              {line(t('receipt.balance_after'), data.balanceAfter, true)}
              <div className="mt-2">{t('receipt.method')}: {p.method ? t(`pay.${p.method}` as TKey) : t('pay.imported')}</div>
              {p.note && <div className="mt-1">{t('common.notes')}: {p.note}</div>}

              <div className="mt-12 flex justify-end">
                <div className="text-center w-[220px]">
                  <div className="border-b border-black/60 h-8" />
                  <div className="text-[13px] mt-1">{t('receipt.received_by')}</div>
                </div>
              </div>
            </div>
          </>
        );
      })()}
    </LoadState>
  );
}
