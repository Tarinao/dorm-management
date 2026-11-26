import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import {
  addTicketPhoto, deleteTicket, removeTicketPhoto, reservationRulesData, saveTicket, setTicketStatus, ticketPhotoUrls,
  type Ticket, type TicketWithRoom,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFeedback } from '../lib/feedback';
import { parseNum } from '../lib/format';
import { friendlyError, useI18n, type TKey } from '../lib/i18n';
import { TICKET_OPEN } from '../lib/reservations';
import { useLoad } from '../lib/useLoad';
import { LoadState, NumInput, StatusPill } from './common';
import { IconCamera, IconX } from './icons';
import { Btn, BtnRow, Desc, Field, FormGrid, Modal, ModalClose, Pill } from './ui';

export const CATEGORIES = ['electric', 'water', 'ac', 'furniture', 'other'] as const;
export const PRIORITIES = ['urgent', 'normal', 'low'] as const;
const REPORTERS = ['staff', 'tenant', 'line'] as const;
const STATUSES = ['open', 'in_progress', 'done', 'cancelled'] as const;

/** Report a problem (new) or edit a ticket, with photos once it is saved. */
export function TicketDialog({ ticket: initial, roomId, onClose, onSaved }: {
  ticket: Ticket | null; roomId?: string; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useFeedback();
  const [ticket, setTicket] = useState<Ticket | null>(initial);
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useLoad(reservationRulesData, []);
  const roomNumber = (id: string) => data?.rooms.find((r) => r.id === id)?.number ?? '';

  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const cost = parseNum(f.get('cost'));
    const room = ticket?.room_id ?? s('room_id');
    if (!room || !s('title') || (cost !== null && cost < 0)) { toast(t('err.check'), 'error'); return; }
    setBusy(true);
    try {
      const saved = await saveTicket(ticket?.id ?? null, {
        room_id: room, title: s('title'), description: s('description'),
        category: s('category') || 'other', priority: s('priority') || 'normal',
        status: ticket ? (s('status') || ticket.status) : 'open',
        reported_by: s('reported_by') || 'staff', block_room: f.get('block_room') === 'on',
        cost, assigned_to: s('assigned_to'),
      });
      toast(t('mt.saved'));
      onSaved();
      if (ticket) onClose();
      else setTicket(saved);            // stay open so photos can be added
    } catch (e) { toast(friendlyError(e, t), 'error'); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} className="max-w-[640px]">
      <ModalClose onClick={onClose} />
      <h2 className="text-xl mt-0">{ticket ? t('mt.edit_title', { n: roomNumber(ticket.room_id) }) : t('mt.new_title')}</h2>
      <LoadState loading={loading && !data} error={error} onRetry={reload}>
        {data && (
          <form key={ticket?.id ?? 'new'} onSubmit={submit}>
            <FormGrid>
              {!ticket && (
                <Field label={t('common.room')}>
                  <select name="room_id" required defaultValue={roomId ?? ''}>
                    <option value="">{t('res.f.room_pick')}</option>
                    {data.rooms.map((r) => <option key={r.id} value={r.id}>{r.number} · {t(`status.${r.status}` as TKey)}</option>)}
                  </select>
                </Field>
              )}
              <Field label={t('mt.f.title')} className="col-span-2 max-[520px]:col-span-1">
                <input name="title" required maxLength={120} defaultValue={ticket?.title ?? ''} autoComplete="off" />
              </Field>
              <Field label={t('mt.f.category')}>
                <select name="category" defaultValue={ticket?.category ?? 'other'}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{t(`mt.cat.${c}` as TKey)}</option>)}
                </select>
              </Field>
              <Field label={t('mt.f.priority')}>
                <select name="priority" defaultValue={ticket?.priority ?? 'normal'}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{t(`mt.prio.${p}` as TKey)}</option>)}
                </select>
              </Field>
              <Field label={t('mt.f.reported_by')}>
                <select name="reported_by" defaultValue={ticket?.reported_by ?? 'staff'}>
                  {REPORTERS.map((r) => <option key={r} value={r}>{t(`mt.by.${r}` as TKey)}</option>)}
                </select>
              </Field>
              {ticket && (
                <Field label={t('common.status')}>
                  <select name="status" defaultValue={ticket.status}>
                    {STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}` as TKey)}</option>)}
                  </select>
                </Field>
              )}
              <Field label={t('mt.f.assigned')}><input name="assigned_to" maxLength={100} defaultValue={ticket?.assigned_to ?? ''} autoComplete="off" /></Field>
              <Field label={t('mt.f.cost')}><NumInput name="cost" defaultValue={ticket?.cost ?? ''} /></Field>
              <Field label={t('mt.f.description')} className="col-span-full">
                <textarea name="description" rows={3} maxLength={4000} defaultValue={ticket?.description ?? ''} />
              </Field>
            </FormGrid>
            <label className="flex items-start gap-2.5 mb-1 text-[14.5px]">
              <input type="checkbox" name="block_room" defaultChecked={ticket?.block_room ?? false} className="mt-1 w-5 h-5" />
              <span>{t('mt.f.block')}</span>
            </label>
            <Desc className="ml-[30px] mt-0 mb-4">{t('mt.f.block_hint')}</Desc>
            <BtnRow className="mb-4">
              <Btn type="submit" disabled={busy}>{busy ? t('common.saving') : t('common.save')}</Btn>
              <Btn variant="secondary" onClick={onClose}>{t('common.close')}</Btn>
            </BtnRow>
          </form>
        )}
      </LoadState>
      <div className="border-t border-line pt-3">
        <div className="text-xs text-muted font-semibold mb-2">{t('mt.f.photos')}</div>
        {ticket ? <TicketPhotos ticket={ticket} onChange={(x) => { setTicket(x); onSaved(); }} /> : <Desc className="m-0">{t('mt.photo_after_save')}</Desc>}
      </div>
    </Modal>
  );
}

function TicketPhotos({ ticket, onChange }: { ticket: Ticket; onChange: (t: Ticket) => void }) {
  const { t } = useI18n();
  const { toast } = useFeedback();
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const key = ticket.photos.join('|');

  useEffect(() => {
    let alive = true;
    ticketPhotoUrls(ticket.photos).then((m) => { if (alive) setUrls(m); }).catch(() => { /* thumbnails are optional */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const add = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try { onChange(await addTicketPhoto(ticket, file)); } catch (e) { toast(friendlyError(e, t), 'error'); } finally { setBusy(false); }
  };
  const remove = async (path: string) => {
    setBusy(true);
    try { onChange(await removeTicketPhoto(ticket, path)); } catch (e) { toast(friendlyError(e, t), 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-wrap gap-2 items-start">
      {ticket.photos.map((p) => (
        <div key={p} className="relative">
          {urls.get(p)
            ? <a href={urls.get(p)} target="_blank" rel="noreferrer"><img src={urls.get(p)} alt="" className="w-24 h-24 object-cover rounded border border-line" /></a>
            : <div className="w-24 h-24 rounded border border-line bg-line/40" />}
          <button type="button" aria-label={t('mt.photo_remove')} title={t('mt.photo_remove')} disabled={busy} onClick={() => void remove(p)}
            className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-paper-raised border border-line text-terracotta flex items-center justify-center p-0">
            <IconX size={14} />
          </button>
        </div>
      ))}
      <label className={`w-24 h-24 rounded border border-dashed border-line flex flex-col items-center justify-center gap-1 text-[12px] text-muted cursor-pointer ${busy ? 'opacity-50' : ''}`}>
        <IconCamera size={22} />{t('mt.add_photo')}
        <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" disabled={busy}
          onChange={(e) => { void add(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
    </div>
  );
}

/** One ticket in a list, with the next step as a button. */
export function TicketCard({ ticket, showRoom = true, onChanged }: { ticket: TicketWithRoom | Ticket; showRoom?: boolean; onChanged: () => void }) {
  const { t, money, date } = useI18n();
  const { isAdmin } = useAuth();
  const { toast, confirm } = useFeedback();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const number = 'rooms' in ticket ? ticket.rooms?.number ?? null : null;
  const open = TICKET_OPEN(ticket.status);

  const move = async (status: 'open' | 'in_progress' | 'done' | 'cancelled') => {
    setBusy(true);
    try { await setTicketStatus(ticket.id, status); toast(t('mt.saved')); onChanged(); }
    catch (e) { toast(friendlyError(e, t), 'error'); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirm({ title: t('mt.delete_title'), body: t('mt.delete_body'), danger: true }))) return;
    try {
      if (!(await deleteTicket(ticket.id))) { toast(t('err.permission'), 'error'); return; }
      toast(t('mt.deleted')); onChanged();
    } catch (e) { toast(friendlyError(e, t), 'error'); }
  };

  return (
    <div className={`border rounded p-3 bg-paper-raised ${open && ticket.priority === 'urgent' ? 'border-terracotta' : 'border-line'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">
            {showRoom && number && <Link to={`/rooms/${encodeURIComponent(number)}`} className="font-display text-lg mr-2 no-underline text-ink">{number}</Link>}
            {ticket.title}
          </div>
          <div className="text-[13px] text-ink-soft mt-0.5">
            {t(`mt.cat.${ticket.category}` as TKey)} · {t(`mt.by.${ticket.reported_by}` as TKey)} · {t('mt.opened', { date: date(ticket.opened_at.slice(0, 10)) })}
            {ticket.closed_at && <> · {t('mt.closed', { date: date(ticket.closed_at.slice(0, 10)) })}</>}
          </div>
          {(ticket.assigned_to || ticket.cost != null) && (
            <div className="text-[13px] text-muted mt-0.5">
              {ticket.assigned_to && t('mt.assigned_line', { name: ticket.assigned_to })}
              {ticket.assigned_to && ticket.cost != null && ' · '}
              {ticket.cost != null && t('mt.cost_line', { amount: money(ticket.cost) })}
            </div>
          )}
          {ticket.description && <div className="text-[13px] text-muted mt-1 whitespace-pre-line line-clamp-3">{ticket.description}</div>}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusPill status={ticket.status} />
          {open && ticket.priority !== 'normal' && <Pill status={ticket.priority === 'urgent' ? 'urgent' : 'cancelled'}>{t(`mt.prio.${ticket.priority}` as TKey)}</Pill>}
          {open && ticket.block_room && <Pill status="maintenance">{t('mt.blocking')}</Pill>}
          {ticket.photos.length > 0 && <span className="text-[12px] text-muted inline-flex items-center gap-1"><IconCamera size={14} />{ticket.photos.length}</span>}
        </div>
      </div>
      <BtnRow className="mt-3">
        {ticket.status === 'open' && <Btn small variant="secondary" disabled={busy} onClick={() => void move('in_progress')}>{t('mt.start')}</Btn>}
        {open && <Btn small disabled={busy} onClick={() => void move('done')}>{t('mt.finish')}</Btn>}
        {!open && <Btn small variant="secondary" disabled={busy} onClick={() => void move('open')}>{t('mt.reopen')}</Btn>}
        <Btn small variant="secondary" disabled={busy} onClick={() => setEditing(true)}>{t('common.edit')}</Btn>
        {open && <Btn small variant="danger" disabled={busy} onClick={() => void move('cancelled')}>{t('mt.cancel')}</Btn>}
        {isAdmin && <Btn small variant="danger" disabled={busy} onClick={() => void remove()}>{t('common.delete')}</Btn>}
      </BtnRow>
      {editing && <TicketDialog ticket={ticket} onClose={() => setEditing(false)} onSaved={onChanged} />}
    </div>
  );
}
