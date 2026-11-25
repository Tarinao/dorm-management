import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { billMessage } from '../../supabase/functions/_shared/core';
import {
  addExtra, deleteBill, deleteExtra, generateBills, getSettings, lastSendRun, listBillsForMonth, loadMonth, sendBillsOnLine,
  type BillExtra, type BillSummary, type Payment, type RunSummary,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import { previewMonth } from '../lib/billing';
import { useFeedback } from '../lib/feedback';
import { bangkokDay, currentMonth, fromMonthInput, meter, monthEnd, parseNum, toMonthInput } from '../lib/format';
import { friendlyError, useI18n, type TKey } from '../lib/i18n';
import { useLoad } from '../lib/useLoad';
import { LoadState, NumInput, StatusPill } from '../components/common';
import { PaymentDialog, PaymentHistory } from '../components/Payments';
import { RoomPricesEditor } from '../components/RoomPrices';
import { AlertBar, Btn, BtnRow, Desc, Empty, Field, Modal, ModalClose, PageHead, Panel, PanelTitle } from '../components/ui';

export default function Billing() {
  const { t, money, month: monthName } = useI18n();
  const { isAdmin } = useAuth();
  const { toast, confirm } = useFeedback();
  const [month, setMonth] = useState(currentMonth);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<RunSummary | null>(null);

  const { data, error, loading, reload } = useLoad(async () => {
    const [settings, md, bills, lastRun] = await Promise.all([getSettings(), loadMonth(month), listBillsForMonth(month), lastSendRun()]);
    return { settings, md, bills, lastRun };
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

  // Generate (like the button above) and send every bill of the month not sent yet on LINE.
  const sendLine = async () => {
    const ok = await confirm({
      title: t('billing.line_confirm_title', { month: monthName(month) }),
      body: t('billing.line_confirm_body'),
      confirmLabel: t('billing.line_send_yes'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      setRun(await sendBillsOnLine(month));
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
                <div className="flex gap-2 flex-wrap">
                  <Btn disabled={busy || ready.length === 0} onClick={() => void generate()}>
                    {busy ? t('billing.generating') : ready.length ? t('billing.generate', { n: ready.length }) : t('billing.generate_none')}
                  </Btn>
                  <Btn variant="secondary" disabled={busy} onClick={() => void sendLine()}>
                    {busy ? t('billing.line_sending') : t('billing.line_send')}
                  </Btn>
                </div>
              </div>
              {data.lastRun && (
                <button type="button" className="text-[13px] text-teal bg-transparent border-0 p-0 underline mb-3"
                  onClick={() => setRun(data.lastRun!.summary as unknown as RunSummary)}>
                  {t('run.last', { date: new Date(data.lastRun.ran_at).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) })}
                </button>
              )}
              <Desc className="mt-0 mb-3">{t(isAdmin ? 'billing.prices_hint' : 'billing.prices_hint_staff')}</Desc>
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
                            {tenantOf(r.roomId) && <span className="text-muted text-[13px]">({tenantOf(r.roomId)})</span>}
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
      {run && <RunDialog run={run} onClose={() => setRun(null)} />}
    </>
  );
}

/** What a "send via LINE" run did, room by room. */
function RunDialog({ run, onClose }: { run: RunSummary; onClose: () => void }) {
  const { t, month } = useI18n();
  const rows: [TKey, string[]][] = [
    ['run.created', run.created], ['run.sent', run.sent], ['run.already_sent', run.already_sent],
    ['run.not_linked', run.not_linked], ['run.paid', run.paid], ['run.no_reading', run.no_reading],
    ['run.meter_backwards', run.meter_backwards], ['run.no_previous_reading', run.no_previous_reading],
    ['run.failed', run.failed.map((f) => `${f.room} (${f.error.slice(0, 80)})`)],
  ];
  const warn: TKey[] = ['run.not_linked', 'run.no_reading', 'run.meter_backwards', 'run.no_previous_reading', 'run.failed'];
  return (
    <Modal onClose={onClose} className="max-w-[560px]">
      <ModalClose onClick={onClose} />
      <h2 className="text-xl mt-0">{t('run.title', { month: month(run.month) })}</h2>
      <dl className="m-0 text-[14px]">
        {rows.map(([k, rooms]) => (
          <div key={k} className="py-2 border-b border-line last:border-0">
            <dt className={`font-semibold ${rooms.length && warn.includes(k) ? 'text-terracotta' : ''}`}>{t(k)}: {rooms.length}</dt>
            <dd className="m-0 text-ink-soft break-words">{rooms.length ? rooms.join(', ') : t('run.none')}</dd>
          </div>
        ))}
      </dl>
      <BtnRow className="mt-4"><Btn onClick={onClose}>{t('common.ok')}</Btn></BtnRow>
    </Modal>
  );
}

function BillCard({ bill, tenant, onChanged }: { bill: BillSummary & { extras: BillExtra[]; payments: Payment[] }; tenant: string; onChanged: () => void }) {
  const { t, money, date } = useI18n();
  const { isAdmin } = useAuth();
  const { toast, confirm } = useFeedback();
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState(false);
  const [manualCopy, setManualCopy] = useState<string | null>(null);
  const open = Number(bill.balance ?? 0) > 0;

  // The same text the LINE message has, for tenants who are not on LINE.
  const copyMessage = async () => {
    const msg = billMessage({
      room: bill.room_number ?? '', tenant: { nickname: tenant }, month: bill.month ?? '', due_date: bill.due_date ?? '',
      rent: bill.rent ?? 0, water_people: bill.water_people ?? 0, water_per_person: bill.water_per_person ?? 0,
      water_amount: bill.water_amount ?? 0, elec_prev: bill.elec_prev ?? 0, elec_curr: bill.elec_curr ?? 0,
      elec_units: bill.elec_units ?? 0, elec_rate: bill.elec_rate ?? 0, elec_amount: bill.elec_amount ?? 0,
      extras: bill.extras, total: bill.total ?? 0, paid: bill.paid ?? 0, balance: bill.balance ?? 0,
    }).replace('กรุณาเลือกวิธีชำระเงินด้านล่าง', 'ชำระได้ทางพร้อมเพย์ โอนเข้าบัญชี หรือเงินสดที่สำนักงาน')
      .replace('Please choose how to pay below.', 'Pay by PromptPay, bank transfer or cash at the office.');
    try {
      await navigator.clipboard.writeText(msg);
      toast(t('billing.copied_msg'));
    } catch {
      setManualCopy(msg);   // clipboard blocked: show the text to copy by hand
    }
  };
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
          {tenant && <span className="text-[13px] text-ink-soft ml-1">({tenant})</span>}
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
      {Number(bill.paid) > 0 && (
        <div className="flex justify-between gap-3 py-1 text-[13.5px] text-ink-soft">
          <span>{t('pay.paid_amount')} {money(bill.paid)}</span>
          <span className={`tabular-nums font-semibold ${open ? 'text-terracotta' : 'text-sage'}`}>{t('pay.balance')} {money(bill.balance)}</span>
        </div>
      )}
      <PaymentHistory payments={bill.payments} onChanged={onChanged} />
      <div className="text-[12.5px] text-muted mt-2">
        {bill.line_sent_at ? t('billing.line_sent_at', { date: date(bangkokDay(bill.line_sent_at)) }) : t('billing.line_not_sent')}
        {bill.pay_method_chosen && <> · {t('billing.pay_choice', { m: t(`paymethod.${bill.pay_method_chosen}` as TKey) })}</>}
      </div>
      {paying && <PaymentDialog bill={bill} onClose={() => setPaying(false)} />}
      {manualCopy && (
        <Modal onClose={() => setManualCopy(null)} className="max-w-[520px]">
          <ModalClose onClick={() => setManualCopy(null)} />
          <h2 className="text-xl mt-0">{t('billing.copy_msg')}</h2>
          <textarea readOnly value={manualCopy} rows={14} className="w-full text-[13px]" autoFocus onFocus={(e) => e.currentTarget.select()} />
        </Modal>
      )}

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
          {open && <Btn small onClick={() => setPaying(true)}>{t('pay.record')}</Btn>}
          <Btn small variant="secondary" onClick={() => setAdding(true)}>{t('billing.add_extra')}</Btn>
          <Btn small variant="secondary" onClick={() => void copyMessage()}>{t('billing.copy_msg')}</Btn>
          {isAdmin && Number(bill.paid) === 0 && <Btn small variant="danger" onClick={() => void removeBill()}>{t('billing.delete_bill')}</Btn>}
        </div>
      )}
    </div>
  );
}
