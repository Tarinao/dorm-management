import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import {
  deleteViewing, linkViewingReservation, reservationRulesData, saveViewing, setViewingStatus, TIMES_OF_DAY,
  type Viewing, type ViewingStatus, type ViewingWithRoom,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFeedback } from '../lib/feedback';
import { todayISO } from '../lib/format';
import { friendlyError, useI18n, type TKey } from '../lib/i18n';
import { useLoad } from '../lib/useLoad';
import { LoadState, StatusPill } from './common';
import { LineAvatar } from './Avatar';
import { ReservationDialog } from './Reservations';
import { AlertBar, Btn, BtnRow, Field, FormGrid, Modal, ModalClose } from './ui';

const isOpen = (s: string) => s === 'requested' || s === 'confirmed';
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');

/** Create or edit a viewing appointment. A viewing never holds a room. */
export function ViewingDialog({ viewing, onClose, onSaved }: {
  viewing: Viewing | null; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useLoad(reservationRulesData, []);

  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const tod = TIMES_OF_DAY.find((x) => x === s('time_of_day')) ?? 'any';
    if (!s('guest_name') || !s('visit_date')) { toast(t('err.check'), 'error'); return; }
    setBusy(true);
    try {
      await saveViewing(viewing?.id ?? null, {
        guest_name: s('guest_name'), phone: s('phone'), visit_date: s('visit_date'), time_of_day: tod,
        visit_time: s('visit_time') || null, room_id: s('room_id') || null, note: s('note'),
      });
      toast(t('vw.saved'));
      onSaved();
    } catch (e) { toast(friendlyError(e, t), 'error'); setBusy(false); }
  };

  return (
    <Modal onClose={onClose} className="max-w-[600px]">
      <ModalClose onClick={onClose} />
      <h2 className="text-xl mt-0">{viewing ? t('vw.edit_title', { name: viewing.guest_name }) : t('vw.new_title')}</h2>
      {viewing?.source === 'line' && viewing.status === 'requested' && <AlertBar kind="info">{t('vw.line_hint')}</AlertBar>}
      <LoadState loading={loading && !data} error={error} onRetry={reload}>
        {data && (
          <form onSubmit={submit}>
            <FormGrid>
              <Field label={t('vw.f.guest_name')}><input name="guest_name" required defaultValue={viewing?.guest_name ?? ''} autoComplete="off" maxLength={100} /></Field>
              <Field label={t('f.phone')}><input name="phone" type="tel" inputMode="tel" defaultValue={viewing?.phone ?? ''} autoComplete="off" maxLength={30} /></Field>
              <Field label={t('vw.f.date')}><input name="visit_date" type="date" required defaultValue={viewing?.visit_date ?? todayISO()} /></Field>
              <Field label={t('vw.f.tod')}>
                <select name="time_of_day" defaultValue={viewing?.time_of_day ?? 'any'}>
                  {TIMES_OF_DAY.map((x) => <option key={x} value={x}>{t(`vw.tod.${x}` as TKey)}</option>)}
                </select>
              </Field>
              <Field label={t('vw.f.time')} hint={t('vw.f.time_hint')}><input name="visit_time" type="time" defaultValue={hhmm(viewing?.visit_time ?? null)} /></Field>
              <Field label={t('vw.f.room')}>
                <select name="room_id" defaultValue={viewing?.room_id ?? ''}>
                  <option value="">{t('vw.any_room')}</option>
                  {data.rooms.map((r) => <option key={r.id} value={r.id}>{r.number} · {t(`status.${r.status}` as TKey)}</option>)}
                </select>
              </Field>
              <Field label={t('common.notes')} className="col-span-full"><textarea name="note" rows={2} defaultValue={viewing?.note ?? ''} /></Field>
            </FormGrid>
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

/** One viewing with its actions: confirm, viewed, no-show, edit, cancel, reserve a room, delete (admin). */
export function ViewingCard({ v, onChanged }: { v: ViewingWithRoom; onChanged: () => void }) {
  const { t, date } = useI18n();
  const { isAdmin } = useAuth();
  const { toast, confirm } = useFeedback();
  const [editing, setEditing] = useState(false);
  const [reserving, setReserving] = useState(false);
  const [busy, setBusy] = useState(false);
  const open = isOpen(v.status);
  const passed = open && v.visit_date < todayISO();

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast(ok); onChanged(); } catch (e) { toast(friendlyError(e, t), 'error'); } finally { setBusy(false); }
  };
  const status = (s: ViewingStatus) => run(() => setViewingStatus(v.id, s), t('vw.status_ok'));
  const cancelIt = async () => {
    if (!(await confirm({ title: t('vw.cancel_title', { name: v.guest_name }), confirmLabel: t('vw.cancel'), danger: true }))) return;
    await status('cancelled');
  };
  const remove = async () => {
    if (!(await confirm({ title: t('vw.delete_title'), body: t('vw.delete_body'), danger: true }))) return;
    setBusy(true);
    try {
      if (!(await deleteViewing(v.id))) { toast(t('err.permission'), 'error'); return; }
      toast(t('vw.deleted')); onChanged();
    } catch (e) { toast(friendlyError(e, t), 'error'); } finally { setBusy(false); }
  };
  const canReserve = !v.reservation_id && v.status !== 'cancelled' && v.status !== 'no_show';

  return (
    <div className={`border rounded p-3 bg-paper-raised ${passed ? 'border-amber' : 'border-line'}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
        <LineAvatar lineUserId={v.line_user_id} name={v.guest_name} size={40} />
        <div className="min-w-0">
          <div className="font-semibold">
            {v.guest_name}
            {v.phone && <a href={`tel:${v.phone}`} className="ml-2 text-[13px] text-teal no-underline font-normal">{v.phone}</a>}
          </div>
          <div className="text-[13px] text-ink-soft mt-0.5">
            {date(v.visit_date)} · {v.visit_time ? hhmm(v.visit_time) : t(`vw.tod.${v.time_of_day}` as TKey)}
            {' · '}{v.rooms?.number ? t('vw.show_room', { n: v.rooms.number }) : t('vw.any_room')}
            {v.source === 'line' && <> · <span className="text-teal">{t('vw.from_line')}</span></>}
          </div>
          {v.note && <div className="text-[13px] text-muted mt-0.5 whitespace-pre-line">{v.note}</div>}
          {passed && <div className="text-[13px] text-amber mt-1">{t('vw.date_passed')}</div>}
          {v.reservation_id && (
            <Link to="/reservations" className="inline-block mt-1 text-[13px] text-teal no-underline">{t('vw.reserved')} →</Link>
          )}
        </div>
        </div>
        <StatusPill status={v.status} />
      </div>
      {(open || canReserve || isAdmin) && (
        <BtnRow className="mt-3">
          {v.status === 'requested' && <Btn small disabled={busy} onClick={() => void status('confirmed')}>{t('vw.confirm')}</Btn>}
          {open && <Btn small variant="secondary" disabled={busy} onClick={() => void status('viewed')}>{t('vw.viewed')}</Btn>}
          {open && <Btn small variant="secondary" disabled={busy} onClick={() => void status('no_show')}>{t('vw.no_show')}</Btn>}
          {canReserve && <Btn small variant="secondary" disabled={busy} onClick={() => setReserving(true)}>{t('vw.reserve')}</Btn>}
          {open && <Btn small variant="secondary" disabled={busy} onClick={() => setEditing(true)}>{t('common.edit')}</Btn>}
          {open && <Btn small variant="danger" disabled={busy} onClick={() => void cancelIt()}>{t('vw.cancel')}</Btn>}
          {isAdmin && <Btn small variant="danger" disabled={busy} onClick={() => void remove()}>{t('common.delete')}</Btn>}
        </BtnRow>
      )}
      {editing && <ViewingDialog viewing={v} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }} />}
      {reserving && (
        <ReservationDialog
          reservation={null}
          prefill={{ guest_name: v.guest_name, phone: v.phone, line_user_id: v.line_user_id, note: v.note, room_id: v.room_id }}
          onClose={() => setReserving(false)}
          onSaved={(saved) => {
            setReserving(false);
            void run(() => linkViewingReservation(v.id, saved.id), t('vw.status_ok'));
          }}
        />
      )}
    </div>
  );
}
