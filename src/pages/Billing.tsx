import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import {
  addExtra, deleteBill, deleteExtra, generateBills, getSettings, listBillsForMonth, loadMonth,
  type BillExtra, type BillSummary,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import { previewMonth } from '../lib/billing';
import { useFeedback } from '../lib/feedback';
import { currentMonth, fromMonthInput, meter, monthEnd, parseNum, toMonthInput } from '../lib/format';
import { friendlyError, useI18n, type TKey } from '../lib/i18n';
import { useLoad } from '../lib/useLoad';
import { LoadState, NumInput, StatusPill } from '../components/common';
import { RoomPricesEditor } from '../components/RoomPrices';
import { AlertBar, Btn, Desc, Empty, Field, PageHead, Panel, PanelTitle } from '../components/ui';

export default function Billing() {
  const { t, money, month: monthName } = useI18n();
  const { toast, confirm } = useFeedback();
  const [month, setMonth] = useState(currentMonth);
  const [busy, setBusy] = useState(false);

  const { data, error, loading, reload } = useLoad(async () => {
    const [settings, md, bills] = await Promise.all([getSettings(), loadMonth(month), listBillsForMonth(month)]);
    return { settings, md, bills };
  }, [month]);

  const preview = useMemo(() => {
    if (!data) return [];
    return previewMonth({
      month, monthEnd: monthEnd(month),
      rooms: data.md.rooms, contracts: data.md.contracts, readings: data.md.readings,
      billedRoomIds: data.md.billedRoomIds,
      electricRate: Number(data.settings.electric_rate),
    }).filter((r) => r.outcome !== 'no_contract');
  }, [data, month]);

  const ready = preview.filter((r) => r.outcome === 'created');
  const tenantOf = (roomId: string) => data?.md.contracts.find((c) => c.room_id === roomId)?.tenant_name ?? '';

  const generate = async () => {
    const ok = await confirm({
      title: t('billing.confirm_title', { n: ready.length, month: monthName(month) }),
      body: t('billing.confirm_body'),
      confirmLabel: t('billing.confirm_yes'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await generateBills(month);
      const created = result.filter((r) => r.outcome === 'created').length;
      toast(t('billing.result', { created, skipped: result.length - created }));
      await reload();
    } catch (e) { toast(friendlyError(e, t), 'error'); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHead title={t('billing.title')} sub={t('billing.subtitle')}>
        <Field label={t('common.month')}>
          <input type="month" value={toMonthInput(month)} onChange={(e) => setMonth(fromMonthInput(e.target.value))} />
        </Field>
      </PageHead>
      <LoadState loading={loading && !data} error={error} onRetry={reload}>
        {data && (
          <>
            <Desc>{t('billing.rates', {
              wo: money(data.settings.water_price_old), wn: money(data.settings.water_price_new),
              e: money(data.settings.electric_rate), d: data.settings.due_day,
            })}</Desc>
            {Number(data.settings.electric_rate) === 0 && <AlertBar kind="warn">{t('billing.rates_zero')}</AlertBar>}

            <Panel>
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <PanelTitle className="m-0">{t('billing.preview', { month: monthName(month) })}</PanelTitle>
                <Btn disabled={busy || ready.length === 0} onClick={() => void generate()}>
                  {busy ? t('billing.generating') : ready.length ? t('billing.generate', { n: ready.length }) : t('billing.generate_none')}
                </Btn>
              </div>
              <Desc className="mt-0 mb-3">{t('billing.prices_hint')}</Desc>
              {preview.length === 0 ? <Empty>{t('meters.empty')}</Empty> : (
                <div className="flex flex-col gap-3">
                  {preview.map((r) => {
                    const room = data.md.rooms.find((x) => x.id === r.roomId)!;
                    const editable = r.outcome !== 'already_billed';
                    return (
                      <div key={r.roomId} className="border border-line rounded p-3">
                        <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
                          <div>
                            <strong className="font-display text-lg mr-2">{r.roomNumber}</strong>
                            <span className="text-muted text-[13px]">{tenantOf(r.roomId)}</span>
                          </div>
                          <span className={`text-[13px] font-semibold ${r.outcome === 'created' ? 'text-sage' : r.outcome === 'already_billed' ? 'text-muted' : 'text-terracotta'}`}>
                            {t(`billing.outcome.${r.outcome}` as TKey)}
                          </span>
                        </div>
                        {editable && (
                          <RoomPricesEditor key={`${room.id}-${room.default_rent}-${room.water_per_person}-${room.occupants}`}
                            room={room} prices={data.settings} onSaved={reload} compact />
                        )}
                        {r.lines && (
                          <div className="text-[13px] text-ink-soft mt-2 tabular-nums">
                            {t('common.rent')} {money(r.lines.rent)}
                            {' · '}{t('billing.water_line', { n: r.lines.waterPeople, r: money(r.lines.waterPerPerson) })} = {money(r.lines.waterAmount)}
                            {' · '}{t('billing.elec_line', { u: meter(r.lines.elecUnits), r: money(r.lines.elecRate) })} = {money(r.lines.elecAmount)}
                            {' · '}<strong className="text-ink">{t('common.total')} {money(r.lines.total)}</strong>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>

            <PanelTitle className="mt-6 mb-3">{t('billing.bills_of', { month: monthName(month) })}</PanelTitle>
            {data.bills.length === 0 ? <Empty>{t('billing.no_bills')}</Empty> : (
              <div className="grid gap-3 md:grid-cols-2">
                {data.bills.map((b) => <BillCard key={b.id} bill={b} tenant={tenantOf(b.room_id ?? '')} onChanged={reload} />)}
              </div>
            )}
          </>
        )}
      </LoadState>
    </>
  );
}

function BillCard({ bill, tenant, onChanged }: { bill: BillSummary & { extras: BillExtra[] }; tenant: string; onChanged: () => void }) {
  const { t, money, date } = useI18n();
  const { isAdmin } = useAuth();
  const { toast, confirm } = useFeedback();
  const [adding, setAdding] = useState(false);
  const status = bill.is_overdue ? 'overdue' : bill.status;

  const add = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const f = new FormData(form);
    const label = String(f.get('label') ?? '').trim(), amount = parseNum(f.get('amount'));
    if (!label || amount === null || amount <= 0) { toast(t('err.check'), 'error'); return; }
    try {
      await addExtra(bill.id!, label, amount);
      form.reset(); setAdding(false);
      toast(t('common.saved'));
      onChanged();
    } catch (e) { toast(friendlyError(e, t), 'error'); }
  };

  const removeExtra = async (x: BillExtra) => {
    if (!(await confirm({ title: t('billing.remove_extra_title'), body: `${x.label} ${money(x.amount)}`, danger: true }))) return;
    try {
      if (!(await deleteExtra(x.id))) { toast(t('err.permission'), 'error'); return; }
      onChanged();
    } catch (e) { toast(friendlyError(e, t), 'error'); }
  };

  const removeBill = async () => {
    if (!(await confirm({ title: t('billing.delete_bill_title', { n: bill.room_number ?? '' }), body: t('billing.delete_bill_body'), danger: true }))) return;
    try {
      if (!(await deleteBill(bill.id!))) { toast(t('err.permission'), 'error'); return; }
      onChanged();
    } catch (e) { toast(friendlyError(e, t), 'error'); }
  };

  const row = (label: string, amount: number | null, sub?: string) => (
    <div className="flex justify-between gap-3 py-1 text-[14px]">
      <span>{label}{sub && <span className="text-muted text-[12px] ml-1">{sub}</span>}</span>
      <span className="tabular-nums">{money(amount)}</span>
    </div>
  );

  return (
    <div className="bg-paper-raised border border-line rounded p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <Link to={`/rooms/${encodeURIComponent(bill.room_number ?? '')}`} className="font-display text-xl font-semibold text-ink no-underline">{bill.room_number}</Link>
          <span className="text-[13px] text-ink-soft ml-2">{tenant}</span>
          <div className="text-[12px] text-muted">{t('billing.due', { date: date(bill.due_date) })}</div>
        </div>
        <StatusPill status={status} />
      </div>
      {row(t('common.rent'), bill.rent)}
      {row(t('billing.water_line', { n: bill.water_people ?? 0, r: money(bill.water_per_person) }), bill.water_amount)}
      {row(t('billing.elec_line', { u: meter(bill.elec_units), r: money(bill.elec_rate) }), bill.elec_amount,
        t('billing.meter_line', { prev: meter(bill.elec_prev), curr: meter(bill.elec_curr) }))}
      {bill.extras.map((x) => (
        <div key={x.id} className="flex justify-between gap-3 py-1 text-[14px]">
          <span>
            {x.label}
            {isAdmin && <button type="button" onClick={() => void removeExtra(x)} className="ml-2 text-terracotta bg-transparent border-0 text-[12px] underline">{t('common.delete')}</button>}
          </span>
          <span className="tabular-nums">{money(x.amount)}</span>
        </div>
      ))}
      <div className="flex justify-between gap-3 pt-2 mt-1 border-t border-line font-semibold">
        <span>{t('common.total')}</span><span className="tabular-nums">{money(bill.total)}</span>
      </div>

      {adding ? (
        <form onSubmit={add} className="grid grid-cols-[1fr_110px] gap-2 mt-3 items-end">
          <Field label={t('billing.extra_label')}><input name="label" required placeholder={t('billing.extra_label_ph')} /></Field>
          <Field label={t('billing.extra_amount')}><NumInput name="amount" required /></Field>
          <div className="col-span-full flex gap-2">
            <Btn type="submit" small>{t('common.save')}</Btn>
            <Btn small variant="secondary" onClick={() => setAdding(false)}>{t('common.cancel')}</Btn>
          </div>
        </form>
      ) : (
        <div className="flex gap-2 mt-3 flex-wrap">
          <Btn small variant="secondary" onClick={() => setAdding(true)}>{t('billing.add_extra')}</Btn>
          {isAdmin && Number(bill.paid) === 0 && <Btn small variant="danger" onClick={() => void removeBill()}>{t('billing.delete_bill')}</Btn>}
        </div>
      )}
    </div>
  );
}
