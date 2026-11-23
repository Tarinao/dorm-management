import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { listRooms } from '../lib/api';
import { useI18n, type TKey } from '../lib/i18n';
import { useLoad } from '../lib/useLoad';
import { LoadState, StatusPill } from '../components/common';
import { RoomStatusIcon } from '../components/icons';
import { Empty, PageHead } from '../components/ui';

const STATUSES = ['vacant', 'occupied', 'reserved', 'maintenance'] as const;

export default function Rooms() {
  const { t, money, date } = useI18n();
  const { data, error, loading, reload } = useLoad(listRooms, []);
  const [filter, setFilter] = useState<string>('all');
  const [q, setQ] = useState('');

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.length ?? 0 };
    for (const r of data ?? []) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [data]);

  const shown = (data ?? []).filter((r) => {
    if (filter !== 'all' && r.status !== filter) return false;
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return r.number.toLowerCase().includes(s) || (r.current?.tenants?.full_name ?? '').toLowerCase().includes(s);
  });

  return (
    <>
      <PageHead title={t('rooms.title')} sub={t('rooms.subtitle', { n: counts.all })} />
      <LoadState loading={loading && !data} error={error} onRetry={reload}>
        <div className="flex flex-wrap gap-2 mb-4">
          {(['all', ...STATUSES] as const).map((s) => (
            <button key={s} type="button" onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-full border text-[13px] ${filter === s ? 'bg-ink text-paper border-ink' : 'bg-transparent border-line text-ink'}`}>
              {s === 'all' ? t('common.all') : t(`status.${s}` as TKey)} ({counts[s] ?? 0})
            </button>
          ))}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('rooms.search')} className="flex-1 min-w-[180px]" />
        </div>
        {shown.length === 0 ? <Empty>{t('rooms.empty')}</Empty> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {shown.map((r) => {
              const vacant = r.status === 'vacant';
              return (
                <Link key={r.id} to={`/rooms/${encodeURIComponent(r.number)}`}
                  className={`block no-underline rounded p-3 border transition-colors ${vacant
                    ? 'bg-line/40 border-line text-muted hover:border-muted'
                    : 'bg-paper-raised border-line text-ink hover:border-teal'}`}>
                  <div className="flex items-start gap-2.5">
                    <RoomStatusIcon status={r.status} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className={`font-display text-xl font-semibold ${vacant ? 'text-muted' : ''}`}>{r.number}</span>
                        <StatusPill status={r.status} />
                      </div>
                      <div className="text-[13.5px] mt-0.5 truncate">
                        {r.current?.tenants?.full_name ?? <span className="text-muted">{t('rooms.no_tenant')}</span>}
                      </div>
                      <div className="text-[12px] text-muted mt-0.5">
                        {money(r.current?.monthly_rent ?? r.default_rent)}
                        {r.current?.end_date ? ` · ${t('rooms.until', { date: date(r.current.end_date) })}` : ''}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </LoadState>
    </>
  );
}
