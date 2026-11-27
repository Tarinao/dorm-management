import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  deleteReservation, reservationRulesData, saveReservation, setReservationStatus,
  type Reservation, type ReservationWithRoom,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFeedback } from '../lib/feedback';
import { parseNum, todayISO } from '../lib/format';
import { friendlyError, useI18n, type TKey } from '../lib/i18n';
import { defaultExpiry, isActive, reservationBlocker } from '../lib/reservations';
import { useLoad } from '../lib/useLoad';
import { LoadState, NumInput, StatusPill } from './common';
import { LineAvatar } from './Avatar';
import { IconReceipt } from './icons';
import { AlertBar, Btn, BtnRow, Desc, Field, FormGrid, Modal, ModalClose } from './ui';

/** Guest details carried into a new reservation, e.g. from a viewing ("Reserve a room"). */
export type ReservationPrefill = { guest_name: string; phone: string; line_user_id: string | null; note: string; room_id: string | null };

/** Create or edit a reservation. Rooms that cannot be booked are shown disabled with the reason
 *  (the same rules the database enforces; the database has the final word). */
export function ReservationDialog({ reservation, roomId, prefill, onClose, onSaved }: {
  reservation: Reservation | null; roomId?: string; prefill?: ReservationPrefill;
  onClose: () => void; onSaved: (saved: Reservation) => void;
}) {
  const { t, money } = useI18n();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useLoad(reservationRulesData, []);
  const [desired, setDesired] = useState(reservation?.desired_move_in ?? todayISO());
  const [expires, setExpires] = useState(reservation?.expires_on ?? defaultExpiry(todayISO()));
  const [expiresTouched, setExpiresTouched] = useState(!!reservation && reservation.expires_on !== defaultExpiry(reservation.desired_move_in));
  const [room, setRoom] = useState(reservation?.room_id ?? roomId ?? prefill?.room_id ?? '');
  const self = reservation?.id ?? null;

  const changeDesired = (v: string) => {
    setDesired(v);
    if (!expiresTouched && v) setExpires(defaultExpiry(v));
  };

  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const fee = parseNum(f.get('booking_fee')) ?? 0;
    const paidOn = s('booking_fee_paid_on') || null;
    const confirmNow = f.get('confirm_now') === 'on';
    if (!s('guest_name') || !desired || !expires || fee < 0 || (paidOn && fee <= 0) || (confirmNow && !room)) {
      toast(t('err.check'), 'error'); return;
    }
    setBusy(true);
    try {
      const saved = await saveReservation(self, {
        room_id: room || null, guest_name: s('guest_name'), phone: s('phone'),
        desired_move_in: desired, expires_on: expires,
        booking_fee: fee, booking_fee_paid_on: paidOn, booking_fee_method: paidOn ? (s('method') === 'transfer' ? 'transfer' : 'cash') : null,
        note: s('note'),
        ...(!self && prefill?.line_user_id ? { line_user_id: prefill.line_user_id } : {}),
      }, confirmNow);
      toast(t('res.saved'));
      onSaved(saved);
    } catch (e) { toast(friendlyError(e, t), 'error'); setBusy(false); }
  };

  return (
    <Modal onClose={onClose} className="max-w-[640px]">
      <ModalClose onClick={onClose} />
      <h2 className="text-xl mt-0">{reservation ? t('res.edit_title', { name: reservation.guest_name }) : t('res.new_title')}</h2>
      {reservation?.source === 'line' && !reservation.room_id && <AlertBar kind="info">{t('res.line_hint')}</AlertBar>}
      <LoadState loading={loading && !data} error={error} onRetry={reload}>
        {data && (
          <form onSubmit={submit}>
            <FormGrid>
              <Field label={t('res.f.room')}>
                <select value={room} onChange={(e) => setRoom(e.target.value)}>
                  <option value="">{t('res.f.room_pick')}</option>
                  {data.rooms.map((r) => {
                    const why = reservationBlocker(r, desired || todayISO(), data, self);
                    return (
                      <option key={r.id} value={r.id} disabled={!!why && r.id !== reservation?.room_id}>
                        {r.number} · {money(r.default_rent)}{why ? ` – ${t(`res.why.${why}` as TKey)}` : ''}
                      </option>
                    );
                  })}
                </select>
              </Field>
              <Field label={t('res.f.guest_name')}><input name="guest_name" required defaultValue={reservation?.guest_name ?? prefill?.guest_name ?? ''} autoComplete="off" maxLength={100} /></Field>
              <Field label={t('f.phone')}><input name="phone" type="tel" inputMode="tel" defaultValue={reservation?.phone ?? prefill?.phone ?? ''} autoComplete="off" maxLength={30} /></Field>
              <Field label={t('res.f.desired')}><input type="date" required value={desired} onChange={(e) => changeDesired(e.target.value)} /></Field>
              <Field label={t('res.f.expires')} hint={t('res.f.expires_hint')}>
                <input type="date" required value={expires} min={desired} onChange={(e) => { setExpires(e.target.value); setExpiresTouched(true); }} />
              </Field>
              <Field label={t('res.f.fee')}><NumInput name="booking_fee" defaultValue={reservation?.booking_fee ?? 0} /></Field>
              <Field label={t('res.f.fee_paid_on')} hint={t('res.f.fee_hint')}>
                <input name="booking_fee_paid_on" type="date" defaultValue={reservation?.booking_fee_paid_on ?? ''} />
              </Field>
              <Field label={t('res.f.method')} className="col-span-2 max-[520px]:col-span-1">
                <div className="flex gap-2">
                  {(['cash', 'transfer'] as const).map((m) => (
                    <label key={m} className="flex-1 flex items-center gap-2 border border-line rounded px-3 py-2.5 cursor-pointer has-[:checked]:border-teal has-[:checked]:bg-teal-soft">
                      <input type="radio" name="method" value={m} defaultChecked={(reservation?.booking_fee_method ?? 'cash') === m} />{t(`pay.${m}` as TKey)}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label={t('common.notes')} className="col-span-full"><textarea name="note" rows={2} defaultValue={reservation?.note ?? prefill?.note ?? ''} /></Field>
            </FormGrid>
            {(!reservation || reservation.status === 'pending') && (
              <label className="flex items-start gap-2.5 mb-4 text-[14.5px]">
                <input type="checkbox" name="confirm_now" className="mt-1 w-5 h-5" disabled={!room} />
                <span>{t('res.f.confirm_now')}</span>
              </label>
            )}
            <BtnRow>
              <Btn type="submit" disabled={busy}>{busy ? t('common.saving') : t('common.save')}</Btn>
              <Btn variant="secondary" onClick={onClose}>{t('common.cancel')}</Btn>
            </BtnRow>
          </form>
        )}
      </LoadState>
    </Modal>
  );
}

/** One reservation with its actions: confirm, edit, convert to move-in, receipt, cancel, delete (admin). */
export function ReservationCard({ r, roomNumber, onChanged, showRoom = true }: {
  r: Reservation | ReservationWithRoom; roomNumber?: string | null; onChanged: () => void; showRoom?: boolean;
}) {
  const { t, money, date } = useI18n();
  const { isAdmin } = useAuth();
  const { toast, confirm } = useFeedback();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const number = roomNumber ?? ('rooms' in r ? r.rooms?.number : null) ?? null;
  const active = isActive(r.status);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast(ok); onChanged(); } catch (e) { toast(friendlyError(e, t), 'error'); } finally { setBusy(false); }
  };
  const confirmIt = () => (r.room_id ? run(() => setReservationStatus(r.id, 'confirmed'), t('res.confirmed_ok')) : toast(t('res.need_room'), 'error'));
  const cancelIt = async () => {
    if (!(await confirm({ title: t('res.cancel_title', { name: r.guest_name }), body: t('res.cancel_body'), confirmLabel: t('res.cancel'), danger: true }))) return;
    await run(() => setReservationStatus(r.id, 'cancelled'), t('res.cancelled_ok'));
  };
  const remove = async () => {
    if (!(await confirm({ title: t('res.delete_title'), body: t('res.delete_body'), danger: true }))) return;
    setBusy(true);
    try {
      if (!(await deleteReservation(r.id))) { toast(t('err.permission'), 'error'); return; }
      toast(t('res.deleted')); onChanged();
    } catch (e) { toast(friendlyError(e, t), 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="border border-line rounded p-3 bg-paper-raised">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
        <LineAvatar lineUserId={r.line_user_id} name={r.guest_name} size={40} />
        <div className="min-w-0">
          <div className="font-semibold">
            {showRoom && (number
              ? <Link to={`/rooms/${encodeURIComponent(number)}`} className="font-display text-lg mr-2 no-underline text-ink">{number}</Link>
              : <span className="text-muted text-[13px] mr-2">{t('res.room_none')}</span>)}
            {r.guest_name}
            {r.phone && <a href={`tel:${r.phone}`} className="ml-2 text-[13px] text-teal no-underline font-normal">{r.phone}</a>}
          </div>
          <div className="text-[13px] text-ink-soft mt-0.5">
            {t('res.move_in', { date: date(r.desired_move_in) })}
            {active && <> · {t('res.expires', { date: date(r.expires_on) })}</>}
            {r.source === 'line' && <> · <span className="text-teal">{t('res.from_line')}</span></>}
          </div>
          <div className="text-[13px] text-muted mt-0.5">
            {Number(r.booking_fee) <= 0 ? t('res.no_fee')
              : r.booking_fee_paid_on ? t('res.fee_paid', { amount: money(r.booking_fee), date: date(r.booking_fee_paid_on) })
              : t('res.fee_unpaid', { amount: money(r.booking_fee) })}
            {r.booking_receipt_no && (
              <Link to={`/reservations/${r.id}/receipt`} className="ml-2 inline-flex items-center gap-1 text-teal no-underline">
                <IconReceipt size={14} />{r.booking_receipt_no}
              </Link>
            )}
          </div>
          {r.note && <div className="text-[13px] text-muted mt-0.5 whitespace-pre-line">{r.note}</div>}
        </div>
        </div>
        <StatusPill status={r.status} />
      </div>
      {(active || isAdmin) && (
        <BtnRow className="mt-3">
          {r.status === 'pending' && <Btn small disabled={busy} onClick={() => void confirmIt()}>{t('res.confirm')}</Btn>}
          {active && number && (
            <Btn small variant={r.status === 'confirmed' ? 'primary' : 'secondary'} disabled={busy}
              onClick={() => navigate(`/rooms/${encodeURIComponent(number)}?movein=${r.id}`)}>{t('res.convert')}</Btn>
          )}
          {active && <Btn small variant="secondary" disabled={busy} onClick={() => setEditing(true)}>{t('common.edit')}</Btn>}
          {active && <Btn small variant="danger" disabled={busy} onClick={() => void cancelIt()}>{t('res.cancel')}</Btn>}
          {isAdmin && <Btn small variant="danger" disabled={busy} onClick={() => void remove()}>{t('common.delete')}</Btn>}
        </BtnRow>
      )}
      {editing && <ReservationDialog reservation={r} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }} />}
    </div>
  );
}

/** "Reserve this room" with the reason when it is not possible right now. */
export function ReserveButton({ roomId, onSaved }: { roomId: string; onSaved: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { data } = useLoad(reservationRulesData, []);
  const room = data?.rooms.find((r) => r.id === roomId);
  const why = room && data ? reservationBlocker(room, '9999-12-31', data) : null;   // any date: is it possible at all?
  return (
    <>
      {why && why !== 'MOVE_IN_BEFORE_MOVE_OUT'
        ? <Desc className="m-0">{t('res.cannot', { why: t(`res.why.${why}` as TKey) })}</Desc>
        : <Btn onClick={() => setOpen(true)}>{t('res.reserve')}</Btn>}
      {open && <ReservationDialog reservation={null} roomId={roomId} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); onSaved(); }} />}
    </>
  );
}
