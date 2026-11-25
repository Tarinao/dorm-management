import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { listBills, listPayments, type BillFilter, type BillRow, type Payment } from '../lib/api';
import { useI18n, type TKey } from '../lib/i18n';
import { useLoad } from '../lib/useLoad';
import { LoadState, StatusPill } from '../components/common';
import { PaymentDialog, PaymentHistory } from '../components/Payments';
import { SlipsPanel } from '../components/Slips';
import { Btn, Empty, PageHead } from '../components/ui';

const FILTERS: BillFilter[] = ['overdue', 'open', 'paid', 'all'];

export default function Payments() {
  const { t, money } = useI18n();
  const [params, setParams] = useSearchParams();
  const filter = (FILTERS as string[]).includes(params.get('filter') ?? '') ? (params.get('filter') as BillFilter) : 'overdue';
  const [q, setQ] = useState('');
  const [paying, setPaying] = useState<BillRow | null>(null);

  const { data, error, loading, reload } = useLoad(async () => {
    const bills = await listBills(filter);
    const payments = await listPayments(bills.map((b) => b.id!).filter(Boolean));
    return { bills, payments };
  }, [filter]);

  const s = q.trim().toLowerCase();
  const shown = (data?.bills ?? []).filter((b) => !s || (b.room_number ?? '').toLowerCase().includes(s) || `${b.tenant_name} ${b.tenant_short}`.toLowerCase().includes(s));
  const balance = shown.reduce((sum, b) => sum + Math.round(Number(b.balance ?? 0) * 100), 0) / 100;

  return (
    <>
      <PageHead title={t('pay.title')} sub={t('pay.subtitle')} />
      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => setParams(f === 'overdue' ? {} : { filter: f }, { replace: true })}
            className={`px-3 py-1.5 rounded-full border text-[13px] ${filter === f ? 'bg-ink text-paper border-ink' : 'bg-transparent border-line text-ink'}`}>
            {t(`pay.filter.${f}` as TKey)}
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('pay.search')} className="flex-1 min-w-[180px]" />
      </div>
      <SlipsPanel onChanged={reload} />
      <LoadState loading={loading && !data} error={error} onRetry={reload}>
        {shown.length === 0 ? <Empty>{t('pay.empty')}</Empty> : (
          <>
            <div className="text-[13px] text-muted mb-3">{t('pay.count', { n: shown.length, amount: money(balance) })}</div>
            <div className="grid gap-3 md:grid-cols-2">
              {shown.map((b) => (
                <BillPayCard key={b.id} bill={b} payments={(data?.payments ?? []).filter((p) => p.bill_id === b.id)}
                  onPay={() => setPaying(b)} onChanged={reload} />
              ))}
            </div>
          </>
        )}
      </LoadState>
      {paying && <PaymentDialog bill={paying} onClose={() => setPaying(null)} />}
    </>
  );
}

/** One bill with its totals, payments and a "Record payment" button. Also used on the room page. */
export function BillPayCard({ bill, payments, onPay, onChanged, showRoom = true }: {
  bill: BillRow; payments: Payment[]; onPay: () => void; onChanged: () => void; showRoom?: boolean;
}) {
  const { t, money, date, month } = useI18n();
  const status = bill.is_overdue ? 'overdue' : bill.status;
  const open = Number(bill.balance ?? 0) > 0;
  return (
    <div className={`bg-paper-raised border rounded p-4 ${bill.is_overdue ? 'border-terracotta' : 'border-line'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {showRoom && <Link to={`/rooms/${encodeURIComponent(bill.room_number ?? '')}`} className="font-display text-xl font-semibold text-ink no-underline mr-2">{bill.room_number}</Link>}
          {bill.tenant_short && <span className="text-[13px] text-ink-soft">{showRoom ? `(${bill.tenant_short})` : `${bill.room_number} (${bill.tenant_short})`}</span>}
          <div className="text-[12.5px] text-muted">{month(bill.month)} · {t('billing.due', { date: date(bill.due_date) })}</div>
        </div>
        <StatusPill status={status} />
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3 text-[12px] text-muted">
        <div>{t('common.total')}<div className="text-ink text-[15px] tabular-nums">{money(bill.total)}</div></div>
        <div>{t('pay.paid_amount')}<div className="text-ink text-[15px] tabular-nums">{money(bill.paid)}</div></div>
        <div>{t('pay.balance')}<div className={`text-[15px] font-semibold tabular-nums ${open ? 'text-terracotta' : 'text-sage'}`}>{money(bill.balance)}</div></div>
      </div>
      <PaymentHistory payments={payments} onChanged={onChanged} />
      {open && <Btn className="mt-3 w-full justify-center py-2.5" onClick={onPay}>{t('pay.record')}</Btn>}
    </div>
  );
}
