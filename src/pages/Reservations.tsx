import { useState } from 'react';
import { listReservations, type ReservationFilter } from '../lib/api';
import { useI18n, type TKey } from '../lib/i18n';
import { useLoad } from '../lib/useLoad';
import { LoadState } from '../components/common';
import { ReservationCard, ReservationDialog } from '../components/Reservations';
import { Btn, Empty, PageHead } from '../components/ui';

const FILTERS: ReservationFilter[] = ['active', 'pending', 'confirmed', 'closed', 'all'];

/** All bookings: filter by status, create, edit, confirm, cancel, convert to move-in. */
export default function Reservations() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<ReservationFilter>('active');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const { data, error, loading, reload } = useLoad(() => listReservations(filter), [filter]);

  const s = q.trim().toLowerCase();
  const shown = (data ?? []).filter((r) => !s || `${r.rooms?.number ?? ''} ${r.guest_name} ${r.phone}`.toLowerCase().includes(s));

  return (
    <>
      <PageHead title={t('res.title')} sub={t('res.subtitle')}>
        <Btn onClick={() => setCreating(true)}>{t('res.new')}</Btn>
      </PageHead>
      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full border text-[13px] ${filter === f ? 'bg-ink text-paper border-ink' : 'bg-transparent border-line text-ink'}`}>
            {t(`res.filter.${f}` as TKey)}
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('rooms.search')} className="flex-1 min-w-[180px]" />
      </div>
      <LoadState loading={loading && !data} error={error} onRetry={reload}>
        {shown.length === 0 ? <Empty>{t('res.empty')}</Empty> : (
          <div className="grid gap-3 md:grid-cols-2">
            {shown.map((r) => <ReservationCard key={r.id} r={r} onChanged={reload} />)}
          </div>
        )}
      </LoadState>
      {creating && <ReservationDialog reservation={null} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void reload(); }} />}
    </>
  );
}
