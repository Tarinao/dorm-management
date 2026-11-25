import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { deletePayment, recordPayment, type Payment } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFeedback } from '../lib/feedback';
import { parseNum, todayISO } from '../lib/format';
import { friendlyError, useI18n, type TKey } from '../lib/i18n';
import { NumInput } from './common';
import { IconReceipt } from './icons';
import { Btn, BtnRow, Desc, Field, FormGrid, Modal, ModalClose } from './ui';

/** The few bill fields the payment widgets need (bill_summary row). */
export interface PayableBill {
  id: string | null; room_number: string | null; month: string | null;
  total: number | null; paid: number | null; balance: number | null;
}

/** Record a payment against one bill. Opens the printable receipt when saved. */
export function PaymentDialog({ bill, onClose }: { bill: PayableBill; onClose: () => void }) {
  const { t, money, month } = useI18n();
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const balance = Number(bill.balance ?? 0);

  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const amount = parseNum(f.get('amount'));
    const paidOn = String(f.get('paid_on') ?? '');
    const method = f.get('method') === 'transfer' ? 'transfer' : 'cash';
    const twoDecimals = /^\d+(\.\d{1,2})?$/.test(String(f.get('amount') ?? '').replace(/,/g, '').trim());
    if (amount === null || amount <= 0 || !paidOn || !twoDecimals) { toast(t('err.check'), 'error'); return; }
    if (amount > balance) { toast(t('pay.too_much', { b: money(balance) }), 'error'); return; }
    setBusy(true);
    try {
      const p = await recordPayment({ billId: bill.id!, amount, paidOn, method, note: String(f.get('note') ?? '') });
      toast(t('pay.done', { no: p.receipt_no }));
      navigate(`/receipts/${p.id}`);
    } catch (e) { toast(friendlyError(e, t), 'error'); setBusy(false); }
  };

  return (
    <Modal onClose={onClose} className="max-w-[520px]">
      <ModalClose onClick={onClose} />
      <h2 className="text-xl mt-0">{t('pay.dialog_title', { n: bill.room_number ?? '' })}</h2>
      <Desc>
        {t('pay.bill_of', { month: month(bill.month) })} · {t('common.total')} {money(bill.total)} · {t('pay.paid_amount')} {money(bill.paid)}
        {' · '}<strong className="text-ink">{t('pay.balance')} {money(balance)}</strong>
      </Desc>
      <form onSubmit={submit}>
        <FormGrid className="mb-4 !grid-cols-2 max-[520px]:!grid-cols-1">
          <Field label={t('pay.amount')} hint={t('pay.amount_hint')}>
            <NumInput name="amount" required defaultValue={balance.toFixed(2)} className="text-lg tabular-nums" />
          </Field>
          <Field label={t('pay.date')}><input name="paid_on" type="date" required defaultValue={todayISO()} /></Field>
          <Field label={t('pay.method')} className="col-span-full">
            <div className="flex gap-2">
              {(['cash', 'transfer'] as const).map((m) => (
                <label key={m} className="flex-1 flex items-center gap-2 border border-line rounded px-3 py-2.5 cursor-pointer has-[:checked]:border-teal has-[:checked]:bg-teal-soft">
                  <input type="radio" name="method" value={m} defaultChecked={m === 'cash'} />{t(`pay.${m}` as TKey)}
                </label>
              ))}
            </div>
          </Field>
          <Field label={t('common.notes')} className="col-span-full"><input name="note" autoComplete="off" /></Field>
        </FormGrid>
        <BtnRow>
          <Btn type="submit" disabled={busy}>{busy ? t('common.saving') : t('pay.save')}</Btn>
          <Btn variant="secondary" onClick={onClose}>{t('common.cancel')}</Btn>
        </BtnRow>
      </form>
    </Modal>
  );
}

/** Payments already made on a bill, each with its receipt. Admin can delete a mistaken one. */
export function PaymentHistory({ payments, onChanged }: { payments: Payment[]; onChanged: () => void }) {
  const { t, money, date } = useI18n();
  const { isAdmin } = useAuth();
  const { toast, confirm } = useFeedback();
  if (payments.length === 0) return null;

  const remove = async (p: Payment) => {
    if (!(await confirm({ title: t('pay.delete_title', { no: p.receipt_no }), body: t('pay.delete_body'), danger: true }))) return;
    try {
      if (!(await deletePayment(p.id))) { toast(t('err.permission'), 'error'); return; }
      onChanged();
    } catch (e) { toast(friendlyError(e, t), 'error'); }
  };

  return (
    <ul className="list-none p-0 m-0 mt-2 flex flex-col gap-1 text-[13px]">
      {payments.map((p) => (
        <li key={p.id} className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-ink-soft">
            {date(p.paid_on)} · {p.method ? t(`pay.${p.method}` as TKey) : t('pay.imported')} · <span className="tabular-nums text-ink">{money(p.amount)}</span>
          </span>
          <span className="flex items-center gap-2">
            <Link to={`/receipts/${p.id}`} className="inline-flex items-center gap-1 text-teal no-underline"><IconReceipt size={15} />{p.receipt_no}</Link>
            {isAdmin && <button type="button" onClick={() => void remove(p)} className="text-terracotta bg-transparent border-0 text-[12px] underline p-0">{t('common.delete')}</button>}
          </span>
        </li>
      ))}
    </ul>
  );
}
