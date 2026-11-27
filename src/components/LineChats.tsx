import { useState } from 'react';
import { lineChatDone, listWantsToTalk, type WantsToTalk } from '../lib/api';
import { useFeedback } from '../lib/feedback';
import { tenantLabel } from '../lib/format';
import { friendlyError, useI18n } from '../lib/i18n';
import { useLoad } from '../lib/useLoad';
import { Avatar } from './Avatar';
import { LoadState } from './common';
import { IconChat } from './icons';
import { Btn, BtnRow, Desc, Panel, PanelTitle } from './ui';

const bangkokTime = (ts: string) =>
  new Date(new Date(ts).getTime() + 7 * 3600_000).toISOString().slice(11, 16);
const bangkokDate = (ts: string) =>
  new Date(new Date(ts).getTime() + 7 * 3600_000).toISOString().slice(0, 10);

/** People who tapped "Contact staff" in the LINE chat. Staff answer in LINE OA Manager, then
 *  tap Done here. The bot stays quiet for them until handover_until (12 hours) or "menu". */
export function LineChats() {
  const { t, date } = useI18n();
  const { toast } = useFeedback();
  const { data, error, loading, reload } = useLoad(listWantsToTalk, []);
  const [busy, setBusy] = useState<string | null>(null);
  const count = data?.length ?? 0;

  const done = async (u: WantsToTalk, botBack: boolean) => {
    setBusy(u.line_user_id);
    try { await lineChatDone(u.line_user_id, botBack); toast(t('chat.done_ok')); }
    catch (e) { toast(friendlyError(e, t), 'error'); }
    finally { setBusy(null); void reload(); }
  };

  return (
    <Panel>
      <div className="flex items-center gap-2 mb-1">
        <PanelTitle className="m-0 flex items-center gap-2"><IconChat size={18} className="text-teal" />{t('chat.title')}</PanelTitle>
        {count > 0 && (
          <span className="min-w-6 h-6 px-1.5 rounded-full bg-terracotta text-white text-[13px] font-semibold inline-flex items-center justify-center tabular-nums"
            aria-label={String(count)}>{count}</span>
        )}
      </div>
      <LoadState loading={loading && !data} error={error} onRetry={reload}>
        {count === 0 ? <Desc className="m-0">{t('chat.empty')}</Desc> : (
          <>
            <Desc className="mt-0 mb-3">{t('chat.hint')}</Desc>
            <ul className="list-none p-0 m-0 flex flex-col gap-3">
              {data!.map((u) => {
                const quiet = u.handover_until && Date.parse(u.handover_until) > Date.now();
                return (
                  <li key={u.line_user_id} className="border border-line rounded p-3">
                    <div className="flex items-center gap-3">
                      <Avatar src={u.picture_url} name={u.display_name || '?'} size={44} />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate">
                          {u.display_name || '—'}
                          <span className="font-normal text-[13px] text-ink-soft ml-2">
                            {u.room ? tenantLabel(u.room, u.tenant) : t('chat.guest')}
                          </span>
                        </div>
                        <div className="text-[13px] text-muted">
                          {t('chat.since', { date: date(bangkokDate(u.wants_talk_at!)), time: bangkokTime(u.wants_talk_at!) })}
                          {quiet && <> · {t('chat.bot_quiet', { time: `${date(bangkokDate(u.handover_until!))} ${bangkokTime(u.handover_until!)}` })}</>}
                        </div>
                      </div>
                    </div>
                    <BtnRow className="mt-3">
                      <Btn small disabled={busy !== null} onClick={() => void done(u, false)}>{t('chat.done')}</Btn>
                      <Btn small variant="secondary" disabled={busy !== null} onClick={() => void done(u, true)}>{t('chat.done_bot')}</Btn>
                    </BtnRow>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </LoadState>
    </Panel>
  );
}
