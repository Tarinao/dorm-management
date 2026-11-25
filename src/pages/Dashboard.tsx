import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { loadDashboard } from '../lib/api';
import { dashboardNumbers, defaultDashMonth } from '../lib/dashboard';
import { currentMonth, fromMonthInput, toMonthInput } from '../lib/format';
import { useI18n, type TKey } from '../lib/i18n';
import { useLoad } from '../lib/useLoad';
import { LoadState } from '../components/common';
import { IconAlert, RoomStatusIcon } from '../components/icons';
import { Field, PageHead, Panel, PanelTitle, Stat, Stats } from '../components/ui';

const pct = (x: number) => Math.round(x * 1000) / 10;

export default function Dashboard() {
  const { t, money, date, month: monthName } = useI18n();
  const { data, error, loading, reload } = useLoad(loadDashboard, []);
  const [picked, setPicked] = useState<string | null>(null);
  const month = picked ?? (data ? defaultDashMonth(data.bills, currentMonth()) : currentMonth());
  const n = useMemo(() => (data ? dashboardNumbers(data.rooms, data.bills, month) : null), [data, month]);

  return (
    <>
      <PageHead title={t('dash.title')} sub={t('dash.subtitle')}>
        <Field label={t('dash.month')}>
          <input type="month" value={toMonthInput(month)} onChange={(e) => setPicked(fromMonthInput(e.target.value))} />
        </Field>
      </PageHead>
      <LoadState loading={loading && !data} error={error} onRetry={reload}>
        {n && (
          <>
            <Stats>
              <Stat label={t('dash.occupancy')} value={`${pct(n.occupancy)}%`}
                foot={t('dash.occupancy_foot', { o: n.byStatus.occupied, t: n.totalRooms })} />
              <Stat label={t('dash.expected')} value={money(n.expected)} valueClass="!text-[22px]"
                foot={t('dash.expected_foot', { n: n.billsInMonth, month: monthName(month) })} />
              <Stat label={t('dash.collected')} value={money(n.collected)} valueClass="!text-[22px] text-sage"
                foot={t('dash.collected_foot', { p: pct(n.collectRate) })} />
              <Stat label={t('dash.outstanding')} value={money(n.outstanding)}
                valueClass={`!text-[22px] ${n.outstanding > 0 ? 'text-terracotta' : ''}`} foot={t('dash.outstanding_foot')} />
            </Stats>

            {n.expected > 0 && (
              <div className="h-2.5 bg-line rounded-full overflow-hidden -mt-4 mb-7" aria-hidden>
                <div className="h-full bg-sage" style={{ width: `${Math.min(100, pct(n.collectRate))}%` }} />
              </div>
            )}

            <Panel>
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <PanelTitle className="m-0 flex items-center gap-2"><IconAlert size={18} className="text-terracotta" />{t('dash.overdue_title')}</PanelTitle>
                {n.overdue.length > 0 && <span className="text-[13px] font-semibold text-terracotta">{t('dash.overdue_total', { amount: money(n.overdueTotal) })}</span>}
              </div>
              {n.overdue.length === 0 ? <div className="text-muted text-[13.5px]">{t('dash.overdue_none')}</div> : (
                <ul className="list-none p-0 m-0 flex flex-col">
                  {n.overdue.map((r) => (
                    <li key={r.roomNumber} className="border-b border-line last:border-0">
                      <Link to={`/rooms/${encodeURIComponent(r.roomNumber)}`} className="flex items-center justify-between gap-3 py-2.5 no-underline text-ink">
                        <span className="min-w-0">
                          <strong className="font-display text-lg mr-2">{r.roomNumber}</strong>
                          {r.tenant && <span className="text-[13px] text-ink-soft">({r.tenant})</span>}
                          <span className="block text-[12px] text-muted">{t('dash.overdue_row', { n: r.bills, date: date(r.oldestDue) })}</span>
                        </span>
                        <span className="tabular-nums font-semibold text-terracotta shrink-0">{money(r.amount)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {n.overdue.length > 0 && <Link to="/payments" className="inline-block mt-3 text-teal text-[13.5px] no-underline">{t('dash.open_payments')} →</Link>}
            </Panel>

            <Panel>
              <PanelTitle className="mt-0 mb-3">{t('dash.rooms_by_status')}</PanelTitle>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {(['occupied', 'vacant', 'reserved', 'maintenance'] as const).map((s) => (
                  <div key={s} className="flex items-center gap-2.5 border border-line rounded p-3">
                    <RoomStatusIcon status={s} size={28} />
                    <div>
                      <div className="font-display text-xl font-semibold tabular-nums">{n.byStatus[s] ?? 0}</div>
                      <div className="text-[12px] text-muted">{t(`status.${s}` as TKey)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </>
        )}
      </LoadState>
    </>
  );
}
