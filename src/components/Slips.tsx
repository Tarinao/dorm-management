import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { confirmSlip, listPendingSlips, rejectSlip, type Slip } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFeedback } from '../lib/feedback';
import { bangkokDay, parseNum, tenantLabel, todayISO } from '../lib/format';
import { friendlyError, useI18n, type TKey } from '../lib/i18n';
import { useLoad } from '../lib/useLoad';
import { LoadState, NumInput } from './common';
import { AlertBar, Btn, BtnRow, Desc, Field, FormGrid, Modal, ModalClose, Panel, PanelTitle } from './ui';

/** "Slips to check": photos tenants sent in the LINE chat. Staff compare each with the bank,
 *  then record the payment (confirm) or mark it not valid. Nothing is paid automatically.
 *  Shows nothing when there are no slips waiting. */
export function SlipsPanel({ onChanged }: { onChanged?: () => void }) {
  const { t } = useI18n();
  const { data, error, loading, reload } = useLoad(listPendingSlips, []);
  const [confirming, setConfirming] = useState<Slip | null>(null);
  const count = data?.length ?? 0;
  if (!error && (loading || count === 0)) return null;

  return (
    <Panel className="mb-5">
      <div className="flex items-center gap-2 mb-1">
        <PanelTitle className="m-0">{t('slip.title')}</PanelTitle>
        {count > 0 && (
          <span className="min-w-6 h-6 px-1.5 rounded-full bg-terracotta text-white text-[13px] font-semibold inline-flex items-center justify-center tabular-nums">{count}</span>
        )}
      </div>
      <LoadState loading={false} error={error} onRetry={reload}>
        <Desc className="mt-0 mb-3">{t('slip.hint')}</Desc>
        <ul className="list-none p-0 m-0 grid gap-3 md:grid-cols-2">
          {data?.map((s) => (
            <SlipCard key={s.id} slip={s} onConfirm={() => setConfirming(s)} onChanged={() => { void reload(); onChanged?.(); }} />
          ))}
        </ul>
      </LoadState>
      {confirming && <ConfirmSlipDialog slip={confirming} onClose={() => setConfirming(null)} onError={() => void reload()} />}
    </Panel>
  );
}

function SlipCard({ slip, onConfirm, onChanged }: { slip: Slip; onConfirm: () => void; onChanged: () => void }) {
  const { t, money, month, date } = useI18n();
  const { session } = useAuth();
  const { toast, confirm } = useFeedback();
  const room = slip.bill?.room_number ?? '';
  const received = new Date(slip.received_at);
  const time = received.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
  const day = bangkokDay(slip.received_at);
  const isDuplicate = !!slip.duplicate_of || (!!slip.qr_ref && !slip.slip_ref);

  const reject = async () => {
    if (!(await confirm({ title: t('slip.reject_title'), body: t('slip.reject_body'), confirmLabel: t('slip.reject'), danger: true }))) return;
    try {
      await rejectSlip(slip.id, session?.user.id);
      toast(t('slip.rejected'));
    } catch (e) { toast(friendlyError(e, t), 'error'); }
    onChanged();
  };

  return (
    <li className="border border-line rounded p-3 flex gap-3">
      {slip.url ? (
        <a href={slip.url} target="_blank" rel="noreferrer" className="shrink-0" title={t('slip.open')}>
          <img src={slip.url} alt={t('slip.open')} className="w-24 h-36 object-cover rounded border border-line bg-paper" />
        </a>
      ) : <span className="w-24 h-36 rounded bg-line shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1 text-[13.5px]">
        <div className="font-semibold text-[15px]">{room ? tenantLabel(room, slip.tenant) : (slip.tenant?.full_name ?? '—')}</div>
        <div className="text-ink-soft">{t('slip.received')}</div>
        <div className="text-muted text-[12.5px]">{t('slip.received_at', { date: date(day), time })}</div>
        {slip.bill
          ? <div className="mt-1">{t('slip.for_bill', { month: month(slip.bill.month), b: money(slip.bill.balance) })}</div>
          : <div className="mt-1 text-terracotta">{t('slip.no_bill')}</div>}
        {isDuplicate && (
          <AlertBar kind="warn">
            <strong>{t('slip.duplicate')}</strong>
            {slip.original && <> · {t('slip.duplicate_of', {
              date: date(bangkokDay(slip.original.received_at)),
              status: t(`slip.status.${slip.original.status}` as TKey),
            })}</>}
          </AlertBar>
        )}
        {!slip.qr_ref && <AlertBar kind="warn">{t('slip.no_qr')}</AlertBar>}
        {slip.qr_ref && !isDuplicate && <div className="text-muted text-[12px] break-all mt-1">{t('slip.ref', { ref: slip.qr_ref.replace(/^raw:/, '').slice(0, 40) })}</div>}
        <BtnRow className="mt-2">
          <Btn small disabled={!slip.bill || Number(slip.bill.balance) <= 0} onClick={onConfirm}>{t('slip.confirm')}</Btn>
          <Btn small variant="secondary" onClick={() => void reject()}>{t('slip.reject')}</Btn>
        </BtnRow>
      </div>
    </li>
  );
}

/** Records a bank-transfer payment for the slip's bill and closes the slip (one database step). */
function ConfirmSlipDialog({ slip, onClose, onError }: { slip: Slip; onClose: () => void; onError: () => void }) {
  const { t, money, month } = useI18n();
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const bill = slip.bill!;
  const balance = Number(bill.balance ?? 0);

  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const raw = String(f.get('amount') ?? '').replace(/,/g, '').trim();
    const amount = parseNum(raw);
    const paidOn = String(f.get('paid_on') ?? '');
    if (amount === null || amount <= 0 || !paidOn || !/^\d+(\.\d{1,2})?$/.test(raw)) { toast(t('err.check'), 'error'); return; }
    if (amount > balance) { toast(t('pay.too_much', { b: money(balance) }), 'error'); return; }
    setBusy(true);
    try {
      const paymentId = await confirmSlip(slip.id, amount, paidOn, String(f.get('note') ?? ''));
      toast(t('common.saved'));
      navigate(`/receipts/${paymentId}`);
    } catch (e) {
      toast(friendlyError(e, t), 'error');
      setBusy(false);
      onError();
    }
  };

  return (
    <Modal onClose={onClose} className="max-w-[560px]">
      <ModalClose onClick={onClose} />
      <h2 className="text-xl mt-0">{t('slip.confirm_title', { n: bill.room_number ?? '' })}</h2>
      <Desc>
        {t('pay.bill_of', { month: month(bill.month) })} · {t('common.total')} {money(bill.total)} · {t('pay.paid_amount')} {money(bill.paid)}
        {' · '}<strong className="text-ink">{t('pay.balance')} {money(balance)}</strong>
      </Desc>
      {slip.url && (
        <a href={slip.url} target="_blank" rel="noreferrer" className="block mb-3">
          <img src={slip.url} alt={t('slip.open')} className="max-h-[50vh] max-w-full rounded border border-line mx-auto block" />
        </a>
      )}
      <form onSubmit={submit}>
        <FormGrid className="mb-4 !grid-cols-2 max-[520px]:!grid-cols-1">
          <Field label={t('pay.amount')} hint={t('slip.confirm_hint')}>
            <NumInput name="amount" required defaultValue={balance.toFixed(2)} className="text-lg tabular-nums" />
          </Field>
          <Field label={t('pay.date')}><input name="paid_on" type="date" required defaultValue={todayISO()} /></Field>
          <Field label={t('common.notes')} className="col-span-full"><input name="note" autoComplete="off" defaultValue={t('paymethod.transfer') + ' (LINE)'} /></Field>
        </FormGrid>
        <BtnRow>
          <Btn type="submit" disabled={busy}>{busy ? t('common.saving') : t('slip.confirm')}</Btn>
          <Btn variant="secondary" onClick={onClose}>{t('common.cancel')}</Btn>
        </BtnRow>
      </form>
    </Modal>
  );
}
