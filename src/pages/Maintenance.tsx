import { useState } from 'react';
import { listTickets, type TicketFilter } from '../lib/api';
import { useI18n, type TKey } from '../lib/i18n';
import { ticketOrder } from '../lib/reservations';
import { useLoad } from '../lib/useLoad';
import { LoadState } from '../components/common';
import { TicketCard, TicketDialog } from '../components/Tickets';
import { Btn, Empty, PageHead } from '../components/ui';

const FILTERS: TicketFilter[] = ['open', 'closed', 'all'];

/** Repair tickets: open ones first, urgent on top. */
export default function Maintenance() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<TicketFilter>('open');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const { data, error, loading, reload } = useLoad(() => listTickets(filter), [filter]);

  const s = q.trim().toLowerCase();
  const shown = (data ?? [])
    .filter((x) => !s || `${x.rooms?.number ?? ''} ${x.title} ${x.assigned_to}`.toLowerCase().includes(s))
    .sort(ticketOrder);

  return (
    <>
      <PageHead title={t('mt.title')} sub={t('mt.subtitle')}>
        <Btn onClick={() => setCreating(true)}>{t('mt.new')}</Btn>
      </PageHead>
      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full border text-[13px] ${filter === f ? 'bg-ink text-paper border-ink' : 'bg-transparent border-line text-ink'}`}>
            {t(`mt.filter.${f}` as TKey)}
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('rooms.search')} className="flex-1 min-w-[180px]" />
      </div>
      <LoadState loading={loading && !data} error={error} onRetry={reload}>
        {shown.length === 0 ? <Empty>{t('mt.empty')}</Empty> : (
          <div className="grid gap-3 md:grid-cols-2">
            {shown.map((x) => <TicketCard key={x.id} ticket={x} onChanged={reload} />)}
          </div>
        )}
      </LoadState>
      {creating && <TicketDialog ticket={null} onClose={() => setCreating(false)} onSaved={() => void reload()} />}
    </>
  );
}
