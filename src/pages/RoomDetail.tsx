import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import {
  getRoom, moveIn, moveOut, updateContract, updateRoom, updateTenant,
  type ContractWithTenant, type Room, type Settings,
} from '../lib/api';
import { RoomPricesEditor } from '../components/RoomPrices';
import { useFeedback } from '../lib/feedback';
import { friendlyError, useI18n, type TKey } from '../lib/i18n';
import { meter, parseNum, todayISO } from '../lib/format';
import { useLoad } from '../lib/useLoad';
import { LoadState, NumInput, StatusPill } from '../components/common';
import { AlertBar, Btn, BtnRow, DataTable, Desc, Empty, Field, FormGrid, Modal, ModalClose, PageHead, Panel, PanelTitle } from '../components/ui';

type Reading = { kind: string; read_on: string; electric: number };

export default function RoomDetail() {
  const { number = '' } = useParams();
  const { t, money, date } = useI18n();
  const { data, error, loading, reload } = useLoad(() => getRoom(number), [number]);
  const [dialog, setDialog] = useState<'in' | 'out' | null>(null);

  return (
    <>
      <Link to="/rooms" className="no-print text-[13.5px] text-teal no-underline">{t('common.back')}</Link>
      <PageHead title={t('common.room_n', { n: number })} sub={data?.room.floor != null ? t('common.floor_n', { n: data.room.floor }) : undefined}>
        {data && <StatusPill status={data.room.status} />}
      </PageHead>
      <LoadState loading={loading && !data} error={error} onRetry={reload}>
        {data === null ? <Empty>{t('room.not_found')}</Empty> : data && (
          <>
            <Panel>
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <PanelTitle className="m-0">{t('room.current')}</PanelTitle>
                {data.current
                  ? <Btn variant="danger" onClick={() => setDialog('out')}>{t('room.move_out')}</Btn>
                  : <Btn onClick={() => setDialog('in')}>{t('room.move_in')}</Btn>}
              </div>
              {data.current
                ? <CurrentTenant key={data.current.id} contract={data.current} onSaved={reload} />
                : <Desc className="m-0">{t('room.no_current')}</Desc>}
            </Panel>

            <Panel>
              <PanelTitle>{t('price.title')}</PanelTitle>
              <Desc>{t('price.hint')}</Desc>
              <RoomPricesEditor key={`${data.room.default_rent}-${data.room.water_per_person}-${data.room.occupants}`}
                room={data.room} prices={data.settings} onSaved={reload} />
            </Panel>

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
                      <strong>{c.tenants?.full_name}</strong> · {date(c.start_date)} – {date(c.moved_out_on)}
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
            {dialog === 'out' && data.current && (
              <MoveOutDialog room={data.room} contract={data.current} lastReading={data.readings[0] ?? null}
                onClose={() => setDialog(null)} onDone={() => { setDialog(null); void reload(); }} />
            )}
          </>
        )}
      </LoadState>
    </>
  );
}

/* ------------------------------------------------------------------ current tenant + contract (editable) */
function CurrentTenant({ contract, onSaved }: { contract: ContractWithTenant; onSaved: () => void }) {
  const { t, date } = useI18n();
  const { toast } = useFeedback();
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
          full_name: s('full_name'), phone: s('phone'), id_card_ref: s('id_card_ref'),
          emergency_name: s('emergency_name'), emergency_phone: s('emergency_phone'),
        });
      }
      await updateContract(contract.id, { end_date: end, deposit });
      toast(t('common.saved'));
      onSaved();
    } catch (e) { toast(friendlyError(e, t), 'error'); } finally { setBusy(false); }
  };

  return (
    <form onSubmit={save}>
      <h3 className="text-[15px] mt-1 mb-2">{t('room.tenant')}</h3>
      <TenantFields tenant={tenant} />
      <h3 className="text-[15px] mt-2 mb-2">{t('room.contract')}</h3>
      <FormGrid>
        <Field label={t('f.start_date')}><input value={date(contract.start_date)} disabled readOnly /></Field>
        <Field label={t('f.end_date')} hint={t('f.end_date_hint')}><input name="end_date" type="date" defaultValue={contract.end_date ?? ''} min={contract.start_date} /></Field>
        <Field label={t('f.deposit')}><NumInput name="deposit" required defaultValue={contract.deposit} /></Field>
      </FormGrid>
      <Btn type="submit" disabled={busy}>{busy ? t('common.saving') : t('common.save')}</Btn>
    </form>
  );
}

function TenantFields({ tenant }: { tenant?: { full_name: string; phone: string; id_card_ref: string; emergency_name: string; emergency_phone: string } | null }) {
  const { t } = useI18n();
  return (
    <FormGrid>
      <Field label={t('f.full_name')}><input name="full_name" required defaultValue={tenant?.full_name ?? ''} autoComplete="off" /></Field>
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
function MoveInDialog({ room, settings, onClose, onDone }: { room: Room; settings: Settings; onClose: () => void; onDone: () => void }) {
  const { t, money } = useI18n();
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
      await moveIn({
        roomId: room.id, fullName: s('full_name'), phone: s('phone'), idCardRef: s('id_card_ref'),
        emergencyName: s('emergency_name'), emergencyPhone: s('emergency_phone'),
        startDate: start, endDate: end, monthlyRent: rent, deposit, electric, waterPerPerson, occupants,
      });
      toast(t('movein.done', { n: room.number }));
      onDone();
    } catch (e) { toast(friendlyError(e, t), 'error'); setBusy(false); }
  };

  return (
    <Modal onClose={onClose} className="max-w-[640px]">
      <ModalClose onClick={onClose} />
      <h2 className="text-xl mt-0">{t('movein.title', { n: room.number })}</h2>
      {room.status === 'maintenance' && <AlertBar kind="warn">{t('movein.maintenance_warn')}</AlertBar>}
      <form onSubmit={submit}>
        <PanelTitle className="mt-3 mb-2">{t('movein.step_tenant')}</PanelTitle>
        <TenantFields />
        <PanelTitle className="mt-1 mb-2">{t('movein.step_contract')}</PanelTitle>
        <FormGrid>
          <Field label={t('f.start_date')}><input name="start_date" type="date" required defaultValue={todayISO()} /></Field>
          <Field label={t('f.end_date')} hint={t('f.end_date_hint')}><input name="end_date" type="date" /></Field>
          <Field label={t('f.monthly_rent')}><NumInput name="monthly_rent" required defaultValue={room.default_rent} /></Field>
          <Field label={t('f.deposit')}><NumInput name="deposit" defaultValue="0" /></Field>
          <Field label={t('price.water')}>
            <select name="water_per_person" defaultValue={String(Number(settings.water_price_new))}>
              <option value={String(Number(settings.water_price_new))}>{t('price.water_new', { p: money(settings.water_price_new) })}</option>
              <option value={String(Number(settings.water_price_old))}>{t('price.water_old', { p: money(settings.water_price_old) })}</option>
            </select>
          </Field>
          <Field label={t('price.people')}>
            <input name="occupants" type="number" inputMode="numeric" min={1} max={20} step={1} required defaultValue={1} />
          </Field>
        </FormGrid>
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
  room: Room; contract: ContractWithTenant; lastReading: Reading | null; onClose: () => void; onDone: () => void;
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
      onDone();
    } catch (e) { toast(friendlyError(e, t), 'error'); setBusy(false); }
  };

  return (
    <Modal onClose={onClose} className="max-w-[560px]">
      <ModalClose onClick={onClose} />
      <h2 className="text-xl mt-0">{t('moveout.title', { n: room.number })}</h2>
      <Desc>{t('moveout.intro', { name: contract.tenants?.full_name ?? '' })}</Desc>
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
