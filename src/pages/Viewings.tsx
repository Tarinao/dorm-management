import { useState } from 'react';
import { listViewings, type ViewingFilter } from '../lib/api';
import { useI18n, type TKey } from '../lib/i18n';
import { useLoad } from '../lib/useLoad';
import { LoadState } from '../components/common';
import { ViewingCard, ViewingDialog } from '../components/Viewings';
import { Btn, Empty, PageHead } from '../components/ui';

const FILTERS: ViewingFilter[] = ['open', 'requested', 'closed', 'all'];

/** Viewing appointments: people coming to see a room (from LINE or added by staff). */
export default function Viewings() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<ViewingFilter>('open');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const { data, error, loading, reload } = useLoad(() => listViewings(filter), [filter]);

  const s = q.trim().toLowerCase();
  const shown = (data ?? []).filter((v) => !s || `${v.rooms?.number ?? ''} ${v.guest_name} ${v.phone}`.toLowerCase().includes(s));

  return (
    <>
      <PageHead title={t('vw.title')} sub={t('vw.subtitle')}>
        <Btn onClick={() => setCreating(true)}>{t('vw.new')}</Btn>
      </PageHead>
      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full border text-[13px] ${filter === f ? 'bg-ink text-paper border-ink' : 'bg-transparent border-line text-ink'}`}>
            {t(`vw.filter.${f}` as TKey)}
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('rooms.search')} className="flex-1 min-w-[180px]" />
      </div>
      <LoadState loading={loading && !data} error={error} onRetry={reload}>
        {shown.length === 0 ? <Empty>{t('vw.empty')}</Empty> : (
          <div className="grid gap-3 md:grid-cols-2">
            {shown.map((v) => <ViewingCard key={v.id} v={v} onChanged={reload} />)}
          </div>
        )}
      </LoadState>
      {creating && <ViewingDialog viewing={null} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void reload(); }} />}
    </>
  );
}
