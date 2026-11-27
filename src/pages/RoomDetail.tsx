import { useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  contractTenantLine, getRoom, listBills, listPayments, moveIn, moveOut, setNicknameForContract, unlinkLine, updateContract, updateRoom, updateTenant,
  type BillRow, type ContractWithTenant, type Reservation, type Room, type Settings, type Ticket,
} from '../lib/api';
import { ReservationCard, ReserveButton } from '../components/Reservations';
import { TicketCard, TicketDialog } from '../components/Tickets';
import { depositDue, ticketOrder } from '../lib/reservations';
import { useAuth } from '../lib/auth';
import { PaymentDialog } from '../components/Payments';
import { RoomPricesEditor } from '../components/RoomPrices';
import { BillPayCard } from './Payments';
import { useFeedback } from '../lib/feedback';
import { friendlyError, useI18n, type TKey } from '../lib/i18n';
import { meter, parseNum, tenantLabel, todayISO } from '../lib/format';
import { useLoad } from '../lib/useLoad';
import { LineAvatar } from '../components/Avatar';
import { LoadState, NumInput, StatusPill } from '../components/common';
import { AlertBar, Btn, BtnRow, DataTable, Desc, Empty, Field, FormGrid, Modal, ModalClose, PageHead, Panel, PanelTitle } from '../components/ui';

type Reading = { kind: string; read_on: string; electric: number };

export default function RoomDetail() {
  const { number = '' } = useParams();
  const { t, money, date } = useI18n();
  const { data, error, loading, reload } = useLoad(() => getRoom(number), [number]);
  const [dialog, setDialog] = useState<'in' | 'out' | null>(null);
  // "Convert to move-in" opens this page with ?movein=<reservation id>: the move-in form, prefilled.
  const [params, setParams] = useSearchParams();
  const convertId = params.get('movein');
  const converting = data && convertId && data.reservation?.id === convertId && !data.current ? data.reservation : null;
  const closeConvert = () => { params.delete('movein'); setParams(params, { replace: true }); };
  // After a move-out of a tenant who was linked to LINE: remind staff to tidy the chat in LINE OA Manager.
  const [lineReminder, setLineReminder] = useState<{ label: string; name: string } | null>(null);

  return (
    <>
      <Link to="/rooms" className="no-print text-[13.5px] text-teal no-underline">{t('common.back')}</Link>
      <PageHead title={t('common.room_n', { n: number })} sub={data?.room.floor != null ? t('common.floor_n', { n: data.room.floor }) : undefined}>
        {data && <StatusPill status={data.room.status} />}
      </PageHead>
      <LoadState loading={loading && !data} error={error} onRetry={reload}>
        {data === null ? <Empty>{t('room.not_found')}</Empty> : data && (
          <>
            {convertId && data.current && <AlertBar kind="warn">{t('err.room_busy')}</AlertBar>}
            <Panel>
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <PanelTitle className="m-0">{t('room.current')}</PanelTitle>
                {data.current
                  ? <Btn variant="danger" onClick={() => setDialog('out')}>{t('room.move_out')}</Btn>
                  : <Btn onClick={() => setDialog('in')}>{t('room.move_in')}</Btn>}
              </div>
              {data.current
                ? <CurrentTenant key={data.current.id} roomNumber={data.room.number} contract={data.current} onSaved={reload} />
                : <Desc className="m-0">{t('room.no_current')}</Desc>}
            </Panel>

            <ReservationPanel room={data.room} reservation={data.reservation} past={data.pastReservations} onChanged={reload} />

            <Panel>
              <PanelTitle>{t('price.title')}</PanelTitle>
              <Desc>{t('price.hint')}</Desc>
              <RoomPricesEditor key={`${data.room.default_rent}-${data.room.water_per_person}-${data.room.occupants}`}
                room={data.room} prices={data.settings} onSaved={reload} />
            </Panel>

            <RoomBills roomId={data.room.id} />

            <TicketsPanel roomId={data.room.id} tickets={data.tickets} onChanged={reload} />

            <RoomForm key={data.room.id + data.room.status} room={data.room} hasTenant={!!data.current} onSaved={reload} />

            <Panel>
              <PanelTitle>{t('room.readings')}</PanelTitle>
              {data.readings.length === 0 ? <Desc>{t('room.readings_empty')}</Desc> : (
                <DataTable>
                  <thead><tr><th>{t('common.date')}</th><th></th><th>{t('meters.electric')}</th></tr></thead>
                  <tbody>
                    {data.readings.map((r) => (
                      <tr key={r.id}>
                        <td>{date(r.read_on)}</td>
                        <td className="text-muted">{t(`room.kind.${r.kind}` as TKey)}</td>
                        <td className="tabular-nums">{meter(r.electric)}</td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              )}
            </Panel>

            <Panel>
              <PanelTitle>{t('room.history')}</PanelTitle>
              {data.past.length === 0 ? <Desc>{t('room.history_empty')}</Desc> : (
                <ul className="list-none p-0 m-0 flex flex-col gap-2">
                  {data.past.map((c) => (
                    <li key={c.id} className="border-b border-line pb-2 last:border-0 text-[14px]">
                      <strong>{tenantLabel(data.room.number, c.tenants)}</strong> {c.tenants?.full_name} · {date(c.start_date)} – {date(c.moved_out_on)}
                      <div className="text-muted text-[13px]">
                        {t('common.rent')} {money(c.monthly_rent)} · {t('common.deposit')} {money(c.deposit)}
                        {c.deposit_returned != null && ` → ${t('moveout.deposit_returned')}: ${money(c.deposit_returned)}`}
                        {c.move_out_note && ` · ${c.move_out_note}`}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {dialog === 'in' && (
              <MoveInDialog room={data.room} settings={data.settings} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void reload(); }} />
            )}
            {converting && (
              <MoveInDialog key={converting.id} room={data.room} settings={data.settings} reservation={converting}
                onClose={closeConvert} onDone={() => { closeConvert(); void reload(); }} />
            )}
            {dialog === 'out' && data.current && (
              <MoveOutDialog room={data.room} contract={data.current} lastReading={data.readings[0] ?? null}
                onClose={() => setDialog(null)} onDone={(reminder) => { setDialog(null); setLineReminder(reminder); void reload(); }} />
            )}
            {lineReminder && (
              <Modal onClose={() => setLineReminder(null)} className="max-w-[460px]">
                <h2 className="text-xl mt-0">{t('line.moveout_title')}</h2>
                <Desc>{t('line.moveout_body', lineReminder)}</Desc>
                <BtnRow><Btn onClick={() => setLineReminder(null)}>{t('common.ok')}</Btn></BtnRow>
              </Modal>
            )}
          </>
        )}
      </LoadState>
    </>
  );
}

/* ------------------------------------------------------------------ this room's bills and payments */
function RoomBills({ roomId }: { roomId: string }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const [paying, setPaying] = useState<BillRow | null>(null);
  const { data, error, loading, reload } = useLoad(async () => {
    const bills = await listBills('all', roomId);
    return { bills, payments: await listPayments(bills.map((b) => b.id!).filter(Boolean)) };
  }, [roomId]);
  // Unpaid bills always show; paid ones only the latest few unless "show older" is tapped.
  const bills = data?.bills ?? [];
  const shown = all ? bills : bills.filter((b, i) => i < 3 || Number(b.balance ?? 0) > 0);

  return (
    <Panel>
      <PanelTitle>{t('pay.room_bills')}</PanelTitle>
      <LoadState loading={loading && !data} error={error} onRetry={reload}>
        {bills.length === 0 ? <Desc>{t('pay.room_bills_empty')}</Desc> : (
          <div className="grid gap-3 md:grid-cols-2">
            {shown.map((b) => (
              <BillPayCard key={b.id} bill={b} showRoom={false} payments={(data?.payments ?? []).filter((p) => p.bill_id === b.id)}
                onPay={() => setPaying(b)} onChanged={reload} />
            ))}
          </div>
        )}
        {!all && shown.length < bills.length && <Btn small variant="secondary" className="mt-3" onClick={() => setAll(true)}>{t('pay.show_older')}</Btn>}
      </LoadState>
      {paying && <PaymentDialog bill={paying} onClose={() => setPaying(null)} />}
    </Panel>
  );
}

/* ------------------------------------------------------------------ current tenant + contract (editable) */
function CurrentTenant({ roomNumber, contract, onSaved }: { roomNumber: string; contract: ContractWithTenant; onSaved: () => void }) {
  const { t, date, money } = useI18n();
  const { toast, confirm } = useFeedback();
  const [busy, setBusy] = useState(false);
  const tenant = contract.tenants;

  const save = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const deposit = parseNum(f.get('deposit'));
    const end = s('end_date') || null;
    if (!s('full_name') || deposit === null || deposit < 0 || (end && end < contract.start_date)) {
      toast(t('err.check'), 'error'); return;
    }
    setBusy(true);
    try {
      if (tenant) {
        await updateTenant(tenant.id, {
          full_name: s('full_name'), nickname: s('nickname'), phone: s('phone'), id_card_ref: s('id_card_ref'),
          emergency_name: s('emergency_name'), emergency_phone: s('emergency_phone'),
        });
      }
      await updateContract(contract.id, { end_date: end, deposit });
      toast(t('common.saved'));
      onSaved();
    } catch (e) { toast(friendlyError(e, t), 'error'); } finally { setBusy(false); }
  };

  const unlink = async () => {
    if (!tenant) return;
    const label = tenantLabel(roomNumber, tenant);
    if (!(await confirm({ title: t('line.unlink_title', { label }), body: t('line.unlink_body'), confirmLabel: t('line.unlink'), danger: true }))) return;
    try {
      await unlinkLine(tenant.id);
      toast(t('line.unlinked'));
      onSaved();
    } catch (e) { toast(friendlyError(e, t), 'error'); }
  };

  return (
    <form onSubmit={save}>
      <h3 className="text-[15px] mt-1 mb-2">{t('room.tenant')} · {tenantLabel(roomNumber, tenant)}</h3>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3 text-[13.5px]">
        {tenant?.line_user_id
          ? <>
              <span className="text-sage font-semibold inline-flex items-center gap-2">
                <LineAvatar lineUserId={tenant.line_user_id} name={tenant.line_display_name || tenant.full_name} size={28} />
                {t('line.status_linked', { name: tenant.line_display_name || '?' })}
              </span>
              <Btn small variant="secondary" onClick={() => void unlink()}>{t('line.unlink')}</Btn>
            </>
          : <span className="text-muted">{t('line.status_not_linked', { n: roomNumber })}</span>}
      </div>
      <TenantFields tenant={tenant} />
      <h3 className="text-[15px] mt-2 mb-2">{t('room.contract')}</h3>
      <FormGrid>
        <Field label={t('f.start_date')}><input value={date(contract.start_date)} disabled readOnly /></Field>
        <Field label={t('f.end_date')} hint={t('f.end_date_hint')}><input name="end_date" type="date" defaultValue={contract.end_date ?? ''} min={contract.start_date} /></Field>
        <Field label={t('f.deposit')} hint={Number(contract.booking_fee_credit) > 0 ? t('contract.fee_credit', { amount: money(contract.booking_fee_credit) }) : undefined}>
          <NumInput name="deposit" required defaultValue={contract.deposit} />
        </Field>
      </FormGrid>
      <Btn type="submit" disabled={busy}>{busy ? t('common.saving') : t('common.save')}</Btn>
    </form>
  );
}

function TenantFields({ tenant }: { tenant?: Partial<{ full_name: string; nickname: string; phone: string; id_card_ref: string; emergency_name: string; emergency_phone: string }> | null }) {
  const { t } = useI18n();
  return (
    <FormGrid>
      <Field label={t('f.full_name')}><input name="full_name" required defaultValue={tenant?.full_name ?? ''} autoComplete="off" /></Field>
      <Field label={t('f.nickname')} hint={t('f.nickname_hint')}><input name="nickname" defaultValue={tenant?.nickname ?? ''} autoComplete="off" maxLength={30} /></Field>
      <Field label={t('f.phone')}><input name="phone" type="tel" inputMode="tel" defaultValue={tenant?.phone ?? ''} autoComplete="off" /></Field>
      <Field label={t('f.id_card_ref')} hint={t('f.id_card_hint')}><input name="id_card_ref" defaultValue={tenant?.id_card_ref ?? ''} autoComplete="off" /></Field>
      <Field label={t('f.emergency_name')}><input name="emergency_name" defaultValue={tenant?.emergency_name ?? ''} autoComplete="off" /></Field>
      <Field label={t('f.emergency_phone')}><input name="emergency_phone" type="tel" inputMode="tel" defaultValue={tenant?.emergency_phone ?? ''} autoComplete="off" /></Field>
    </FormGrid>
  );
}

/* ------------------------------------------------------------------ room details */
function RoomForm({ room, hasTenant, onSaved }: { room: Room; hasTenant: boolean; onSaved: () => void }) {
  const { t } = useI18n();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);

  const save = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    setBusy(true);
    try {
      await updateRoom(room.id, {
        notes: String(f.get('notes') ?? ''),
        ...(hasTenant ? {} : { status: String(f.get('status')) }),
      });
      toast(t('common.saved'));
      onSaved();
    } catch (e) { toast(friendlyError(e, t), 'error'); } finally { setBusy(false); }
  };

  return (
    <Panel>
      <PanelTitle>{t('room.details')}</PanelTitle>
      <form onSubmit={save}>
        <FormGrid>
          <Field label={t('common.status')} hint={t('room.status_hint')}>
            <select name="status" defaultValue={room.status} disabled={hasTenant}>
              {hasTenant && <option value="occupied">{t('status.occupied')}</option>}
              <option value="vacant">{t('status.vacant')}</option>
              <option value="reserved">{t('status.reserved')}</option>
              <option value="maintenance">{t('status.maintenance')}</option>
            </select>
          </Field>
          <Field label={t('common.notes')} className="col-span-full"><textarea name="notes" defaultValue={room.notes} rows={2} /></Field>
        </FormGrid>
        <Btn type="submit" disabled={busy}>{busy ? t('common.saving') : t('room.save')}</Btn>
      </form>
    </Panel>
  );
}

/* ------------------------------------------------------------------ move in */
function MoveInDialog({ room, settings, reservation = null, onClose, onDone }: {
  room: Room; settings: Settings; reservation?: Reservation | null; onClose: () => void; onDone: () => void;
}) {
  const { t, money } = useI18n();
  // A paid booking fee counts toward the deposit (the database credits it on the contract).
  const credit = reservation?.booking_fee_paid_on ? Number(reservation.booking_fee) : 0;
  const [depositText, setDepositText] = useState(credit > 0 ? String(credit) : '0');
  const { isAdmin } = useAuth();
  // Staff check in at the room's own prices (the database enforces the same rule).
  const roomWater = String(Number(room.water_per_person));
  const waterOptions = [...new Set([String(Number(settings.water_price_new)), String(Number(settings.water_price_old)), roomWater])];
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);

  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const rent = parseNum(f.get('monthly_rent')), deposit = parseNum(f.get('deposit')) ?? 0;
    const electric = parseNum(f.get('electric'));
    const waterPerPerson = parseNum(f.get('water_per_person')), occupants = parseNum(f.get('occupants'));
    const start = s('start_date'), end = s('end_date') || null;
    if (!s('full_name') || !start || rent === null || rent < 0 || deposit < 0 ||
        waterPerPerson === null || occupants === null || !Number.isInteger(occupants) || occupants < 1 || occupants > 20 ||
        electric === null || electric < 0 || (end && end < start)) {
      toast(t('err.check'), 'error'); return;
    }
    setBusy(true);
    try {
      const contractId = await moveIn({
        roomId: room.id, fullName: s('full_name'), phone: s('phone'), idCardRef: s('id_card_ref'),
        emergencyName: s('emergency_name'), emergencyPhone: s('emergency_phone'),
        startDate: start, endDate: end, monthlyRent: rent, deposit, electric, waterPerPerson, occupants,
        reservationId: reservation?.id ?? null,
      });
      if (s('nickname')) await setNicknameForContract(contractId, s('nickname'));
      let done = t('movein.done', { n: room.number });
      if (reservation?.line_user_id) {
        // The database links the guest's LINE account, except when it belongs to a current tenant.
        const linked = await contractTenantLine(contractId).catch(() => null);
        done += ' ' + (linked === reservation.line_user_id ? t('movein.line_linked') : t('movein.line_kept'));
      }
      toast(done);
      onDone();
    } catch (e) { toast(friendlyError(e, t), 'error'); setBusy(false); }
  };

  return (
    <Modal onClose={onClose} className="max-w-[640px]">
      <ModalClose onClick={onClose} />
      <h2 className="text-xl mt-0">{t('movein.title', { n: room.number })}</h2>
      {room.status === 'maintenance' && <AlertBar kind="warn">{t('movein.maintenance_warn')}</AlertBar>}
      {reservation && <AlertBar kind="info">{t('movein.from_reservation', { name: reservation.guest_name })}</AlertBar>}
      {reservation?.line_user_id && (
        <AlertBar kind="info">
          <span className="inline-flex items-center gap-2">
            <LineAvatar lineUserId={reservation.line_user_id} name={reservation.guest_name} size={28} />
            {t('movein.line_hint')}
          </span>
        </AlertBar>
      )}
      <form onSubmit={submit}>
        <PanelTitle className="mt-3 mb-2">{t('movein.step_tenant')}</PanelTitle>
        <TenantFields tenant={reservation ? { full_name: reservation.guest_name, phone: reservation.phone } : null} />
        <PanelTitle className="mt-1 mb-2">{t('movein.step_contract')}</PanelTitle>
        <FormGrid>
          <Field label={t('f.start_date')}><input name="start_date" type="date" required defaultValue={reservation?.desired_move_in ?? todayISO()} /></Field>
          <Field label={t('f.end_date')} hint={t('f.end_date_hint')}><input name="end_date" type="date" /></Field>
          <Field label={t('f.monthly_rent')}>
            {isAdmin
              ? <NumInput name="monthly_rent" required defaultValue={room.default_rent} />
              : <><input value={money(room.default_rent)} disabled readOnly /><input type="hidden" name="monthly_rent" value={room.default_rent} /></>}
          </Field>
          <Field label={t('f.deposit')}
            hint={credit > 0 ? t('movein.fee_credit', { amount: money(credit), due: money(depositDue(parseNum(depositText) ?? 0, credit)) }) : undefined}>
            <NumInput name="deposit" value={depositText} onChange={(e) => setDepositText(e.target.value)} />
          </Field>
          <Field label={t('price.water')}>
            {isAdmin ? (
              <select name="water_per_person" defaultValue={String(Number(settings.water_price_new))}>
                {waterOptions.map((v) => (
                  <option key={v} value={v}>
                    {Number(v) === Number(settings.water_price_new) ? t('price.water_new', { p: money(v) })
                      : Number(v) === Number(settings.water_price_old) ? t('price.water_old', { p: money(v) })
                      : t('price.water_other', { p: money(v) })}
                  </option>
                ))}
              </select>
            ) : <><input value={money(room.water_per_person)} disabled readOnly /><input type="hidden" name="water_per_person" value={roomWater} /></>}
          </Field>
          <Field label={t('price.people')}>
            <input name="occupants" type="number" inputMode="numeric" min={1} max={20} step={1} required defaultValue={1} />
          </Field>
        </FormGrid>
        {!isAdmin && <Desc className="-mt-2">{t('movein.prices_from_room')}</Desc>}
        <PanelTitle className="mt-1 mb-1">{t('movein.step_meters')}</PanelTitle>
        <Desc className="mt-0 mb-2">{t('movein.meters_hint')}</Desc>
        <FormGrid>
          <Field label={t('movein.elec_start')}><NumInput name="electric" required /></Field>
        </FormGrid>
        <BtnRow>
          <Btn type="submit" disabled={busy}>{busy ? t('common.saving') : t('movein.submit')}</Btn>
          <Btn variant="secondary" onClick={onClose}>{t('common.cancel')}</Btn>
        </BtnRow>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ move out */
function MoveOutDialog({ room, contract, lastReading, onClose, onDone }: {
  room: Room; contract: ContractWithTenant; lastReading: Reading | null; onClose: () => void;
  onDone: (lineReminder: { label: string; name: string } | null) => void;
}) {
  const { t, money } = useI18n();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);

  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const d = String(f.get('date') ?? '');
    const electric = parseNum(f.get('electric'));
    const returned = parseNum(f.get('deposit_returned')) ?? 0;
    const roomStatus = String(f.get('room_status')) as 'vacant' | 'maintenance' | 'reserved';
    if (!d || d < contract.start_date || electric === null || electric < 0 || returned < 0) { toast(t('err.check'), 'error'); return; }
    if (lastReading && electric < Number(lastReading.electric)) { toast(t('meters.backwards'), 'error'); return; }
    setBusy(true);
    try {
      await moveOut({ contractId: contract.id, date: d, electric, depositReturned: returned, note: String(f.get('note') ?? ''), roomStatus });
      toast(t('moveout.done', { n: room.number, status: t(`status.${roomStatus}` as TKey) }));
      // move_out() cleared the LINE link; staff still has to tidy the chat in LINE OA Manager.
      const tn = contract.tenants;
      onDone(tn?.line_user_id ? { label: tenantLabel(room.number, tn), name: tn.line_display_name || '?' } : null);
    } catch (e) { toast(friendlyError(e, t), 'error'); setBusy(false); }
  };

  return (
    <Modal onClose={onClose} className="max-w-[560px]">
      <ModalClose onClick={onClose} />
      <h2 className="text-xl mt-0">{t('moveout.title', { n: room.number })}</h2>
      <Desc>{t('moveout.intro', { name: tenantLabel(room.number, contract.tenants) })}</Desc>
      <form onSubmit={submit}>
        <FormGrid>
          <Field label={t('moveout.date')}><input name="date" type="date" required defaultValue={todayISO()} min={contract.start_date} /></Field>
          <Field label={t('moveout.final_elec')}
            hint={lastReading ? t('moveout.last_reading', { e: meter(lastReading.electric) }) : undefined}>
            <NumInput name="electric" required />
          </Field>
          <Field label={t('moveout.deposit_returned')} hint={t('moveout.deposit_held', { amount: money(contract.deposit) })}>
            <NumInput name="deposit_returned" defaultValue={contract.deposit} />
          </Field>
          <Field label={t('moveout.room_after')}>
            <select name="room_status" defaultValue="vacant">
              <option value="vacant">{t('status.vacant')}</option>
              <option value="maintenance">{t('status.maintenance')}</option>
              <option value="reserved">{t('status.reserved')}</option>
            </select>
          </Field>
          <Field label={t('moveout.note')} className="col-span-full"><textarea name="note" rows={2} /></Field>
        </FormGrid>
        <Desc>{t('moveout.final_bill_hint')}</Desc>
        <BtnRow>
          <Btn type="submit" variant="dangerSolid" disabled={busy}>{busy ? t('common.saving') : t('moveout.submit')}</Btn>
          <Btn variant="secondary" onClick={onClose}>{t('common.cancel')}</Btn>
        </BtnRow>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ reservation of this room */
function ReservationPanel({ room, reservation, past, onChanged }: {
  room: Room; reservation: Reservation | null; past: Reservation[]; onChanged: () => void;
}) {
  const { t, date } = useI18n();
  const [showPast, setShowPast] = useState(false);
  return (
    <Panel>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <PanelTitle className="m-0">{t('res.room_title')}</PanelTitle>
        {!reservation && <ReserveButton key={room.status} roomId={room.id} onSaved={onChanged} />}
      </div>
      {reservation
        ? <ReservationCard r={reservation} roomNumber={room.number} showRoom={false} onChanged={onChanged} />
        : <Desc className="m-0">{t('res.room_none_active')}</Desc>}
      {past.length > 0 && (
        <div className="mt-3">
          {!showPast
            ? <Btn small variant="secondary" onClick={() => setShowPast(true)}>{t('res.past')} ({past.length})</Btn>
            : (
              <ul className="list-none p-0 m-0 flex flex-col gap-1 text-[13px]">
                {past.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 flex-wrap">
                    <StatusPill status={r.status} />
                    <span>{r.guest_name}</span>
                    <span className="text-muted">{t('res.move_in', { date: date(r.desired_move_in) })}</span>
                    {r.booking_receipt_no && <Link to={`/reservations/${r.id}/receipt`} className="text-teal no-underline">{r.booking_receipt_no}</Link>}
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ repairs of this room */
function TicketsPanel({ roomId, tickets, onChanged }: { roomId: string; tickets: Ticket[]; onChanged: () => void }) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const [all, setAll] = useState(false);
  const sorted = [...tickets].sort(ticketOrder);
  const shown = all ? sorted : sorted.filter((x, i) => i < 3 || x.status === 'open' || x.status === 'in_progress');
  return (
    <Panel>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <PanelTitle className="m-0">{t('mt.room_title')}</PanelTitle>
        <Btn variant="secondary" onClick={() => setCreating(true)}>{t('mt.new')}</Btn>
      </div>
      {tickets.length === 0 ? <Desc className="m-0">{t('mt.room_empty')}</Desc> : (
        <div className="grid gap-3 md:grid-cols-2">
          {shown.map((x) => <TicketCard key={x.id} ticket={x} showRoom={false} onChanged={onChanged} />)}
        </div>
      )}
      {!all && shown.length < sorted.length && <Btn small variant="secondary" className="mt-3" onClick={() => setAll(true)}>{t('pay.show_older')}</Btn>}
      {creating && <TicketDialog ticket={null} roomId={roomId} onClose={() => setCreating(false)} onSaved={onChanged} />}
    </Panel>
  );
}
