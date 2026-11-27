import { useMemo, useState } from 'react';
import { loadMonth, saveMonthlyReading } from '../lib/api';
import { compareReadings, pickContract, type Reading } from '../lib/billing';
import { useFeedback } from '../lib/feedback';
import { currentMonth, fromMonthInput, meter, monthEnd, parseNum, toMonthInput, todayISO } from '../lib/format';
import { friendlyError, useI18n } from '../lib/i18n';
import { useLoad } from '../lib/useLoad';
import { LoadState, NumInput, StatusPill } from '../components/common';
import { IconCheck, IconZap, RoomStatusIcon } from '../components/icons';
import { Btn, Empty, Field, PageHead } from '../components/ui';

interface CardData {
  roomId: string;
  number: string;
  status: string;
  tenant: string | null;   // null = nobody lives here this month
  saved: Reading | null;   // this month's monthly reading, if any
  prev: Reading | null;    // the reading before it
  billed: boolean;
}

type Show = 'occupied' | 'all' | 'todo';

export default function Meters() {
  const { t, month: monthName } = useI18n();
  const [month, setMonth] = useState(currentMonth);
  const [readOn, setReadOn] = useState(todayISO);
  const [show, setShow] = useState<Show>('occupied');
  const { data, error, loading, reload } = useLoad(() => loadMonth(month), [month]);

  // Every room gets a card (vacant rooms too); rooms with a tenant this month come first.
  const cards = useMemo<CardData[]>(() => {
    if (!data) return [];
    const end = monthEnd(month);
    const out = data.rooms.map((room) => {
      const contract = pickContract(data.contracts.filter((c) => c.room_id === room.id), month, end);
      const rr = data.readings.filter((r) => r.room_id === room.id);
      const saved = rr.find((r) => r.kind === 'monthly' && r.month === month) ?? null;
      const before = rr.filter((r) => r !== saved && (!saved || compareReadings(r, saved) < 0)).sort(compareReadings);
      return {
        roomId: room.id, number: room.number, status: room.status,
        tenant: contract ? (data.contracts.find((c) => c.id === contract.id)?.tenant_name ?? '') : null,
        saved, prev: before[before.length - 1] ?? null,
        billed: data.usageBilledRoomIds.has(room.id),
      };
    });
    return [...out.filter((c) => c.tenant !== null), ...out.filter((c) => c.tenant === null)];
  }, [data, month]);

  const occupied = cards.filter((c) => c.tenant !== null);
  const done = occupied.filter((c) => c.saved).length;
  const shown = show === 'occupied' ? occupied : show === 'todo' ? cards.filter((c) => !c.saved) : cards;

  return (
    <>
      <PageHead title={t('meters.title')} sub={t('meters.subtitle')} />
      <div className="grid grid-cols-2 gap-3 mb-3 max-w-[420px]">
        <Field label={t('common.month')}>
          <input type="month" value={toMonthInput(month)} onChange={(e) => setMonth(fromMonthInput(e.target.value))} />
        </Field>
        <Field label={t('meters.read_on')}>
          <input type="date" value={readOn} onChange={(e) => setReadOn(e.target.value || todayISO())} />
        </Field>
      </div>
      <LoadState loading={loading && !data} error={error} onRetry={reload}>
        <div className="font-semibold mb-2">{monthName(month)} · {t('meters.progress', { done, total: occupied.length })}</div>
        <div className="h-2 bg-line rounded-full overflow-hidden mb-3">
          <div className="h-full bg-sage" style={{ width: occupied.length ? `${(done / occupied.length) * 100}%` : '0%' }} />
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          {([['occupied', t('meters.show_occupied', { n: occupied.length })], ['all', t('meters.show_all', { n: cards.length })],
            ['todo', t('meters.show_todo')]] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setShow(k)}
              className={`px-3 py-1.5 rounded-full border text-[13px] ${show === k ? 'bg-ink text-paper border-ink' : 'bg-transparent border-line text-ink'}`}>
              {label}
            </button>
          ))}
        </div>
        {shown.length === 0 ? <Empty>{t('meters.empty')}</Empty> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((c) => (
              <MeterCard key={`${c.roomId}-${month}`} card={c} month={month} readOn={readOn} onSaved={reload} />
            ))}
          </div>
        )}
      </LoadState>
    </>
  );
}

function MeterCard({ card, month, readOn, onSaved }: { card: CardData; month: string; readOn: string; onSaved: () => void }) {
  const { t, date } = useI18n();
  const { toast } = useFeedback();
  const [value, setValue] = useState(card.saved ? String(Number(card.saved.electric)) : '');
  const [busy, setBusy] = useState(false);

  const v = parseNum(value);
  const prev = card.prev ? Number(card.prev.electric) : null;
  const used = v !== null && prev !== null ? Math.round((v - prev) * 10) / 10 : null;
  const backwards = used !== null && used < 0;
  const changed = !card.saved || v !== Number(card.saved.electric);
  const vacant = card.tenant === null;

  const save = async () => {
    if (v === null || v < 0) { toast(t('meters.need_number'), 'error'); return; }
    if (backwards) { toast(t('meters.backwards'), 'error'); return; }
    setBusy(true);
    try {
      await saveMonthlyReading(card.roomId, month, readOn, v);
      toast(`${t('common.room_n', { n: card.number })} — ${t('common.saved')}`);
      onSaved();
    } catch (err) { toast(friendlyError(err, t), 'error'); } finally { setBusy(false); }
  };

  return (
    <div className={`border rounded p-3 ${card.saved ? 'border-sage' : 'border-line'} ${vacant ? 'bg-line/40' : 'bg-paper-raised'}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <RoomStatusIcon status={card.status} size={24} />
          <span className={`font-display text-xl font-semibold ${vacant ? 'text-muted' : ''}`}>{card.number}</span>
          {card.tenant && <span className="text-[14px] text-ink-soft truncate">({card.tenant})</span>}
        </div>
        {card.saved
          ? <span className="flex items-center gap-1 text-[12px] font-semibold text-sage shrink-0"><IconCheck size={15} />{date(card.saved.read_on)}</span>
          : vacant && <StatusPill status={card.status} />}
      </div>
      <label className="flex items-center gap-1.5 text-[13px] font-semibold mb-1">
        <IconZap size={16} className="text-amber" />{t('meters.electric')}
      </label>
      <NumInput value={value} onChange={(ev) => setValue(ev.target.value)} placeholder={t('meters.now')}
        className="w-full text-lg tabular-nums" aria-label={`${t('common.room_n', { n: card.number })} ${t('meters.electric')}`} />
      <div className="text-[12px] text-muted mt-1 tabular-nums">
        {prev === null ? t('meters.no_prev') : `${t('meters.prev')} ${meter(prev)}`}
        {used !== null && used >= 0 && <> · {t('meters.used')} <strong className="text-ink">{meter(used)}</strong> {t('common.units')}</>}
      </div>
      {backwards && <div className="text-terracotta text-[13px] mt-2">{t('meters.backwards')}</div>}
      {card.billed && <div className="text-amber text-[12.5px] mt-2">{t('meters.billed_note')}</div>}
      {vacant && <div className="text-muted text-[12px] mt-2">{t('meters.vacant_note')}</div>}
      <Btn className="mt-3 w-full justify-center py-3" disabled={busy || !changed || v === null}
        variant={card.saved ? 'secondary' : 'primary'} onClick={() => void save()}>
        {busy ? t('common.saving') : card.saved ? t('meters.update') : t('meters.save')}
      </Btn>
    </div>
  );
}
