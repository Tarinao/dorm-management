import { useState } from 'react';
import { decideLineRequest, listLineRequests, type LineDecision, type LineRequest, type RoomWithCurrent } from '../lib/api';
import { useFeedback } from '../lib/feedback';
import { tenantLabel } from '../lib/format';
import { friendlyError, useI18n } from '../lib/i18n';
import { useLoad } from '../lib/useLoad';
import { LoadState } from './common';
import { AlertBar, Btn, BtnRow, Desc, Modal, ModalClose, Panel, PanelTitle } from './ui';

/** "LINE requests" on the Rooms page: tenants who typed their room number in the LINE OA chat.
 *  Approve links the LINE account to the room's CURRENT tenant; reject sends a polite reply. */
export function LineRequests({ rooms, onChanged }: { rooms: RoomWithCurrent[]; onChanged: () => void }) {
  const { t } = useI18n();
  const { toast, confirm } = useFeedback();
  const { data, error, loading, reload } = useLoad(listLineRequests, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<LineDecision | null>(null);
  const count = data?.length ?? 0;

  const roomOf = (n: string) => rooms.find((r) => r.number === n) ?? null;
  // Where this LINE user is linked now (if anywhere).
  const linkedTo = (lineUserId: string) => rooms.find((r) => r.current?.tenants?.line_user_id === lineUserId) ?? null;

  const decide = async (req: LineRequest, action: 'approve' | 'reject') => {
    if (action === 'reject') {
      const ok = await confirm({ title: t('line.reject_title', { n: req.room_number_typed }), body: t('line.reject_body'), confirmLabel: t('line.reject'), danger: true });
      if (!ok) return;
    }
    setBusy(req.id);
    try {
      const res = await decideLineRequest(action, req.id);
      if (action === 'approve') setDone(res);
      else toast(res.pushed ? t('line.rejected') : t('line.push_failed', { e: res.push_error ?? '' }), res.pushed ? 'ok' : 'error');
      onChanged();
    } catch (e) {
      toast(friendlyError(e, t), 'error');
    } finally {
      setBusy(null);
      void reload();
    }
  };

  return (
    <Panel>
      <div className="flex items-center gap-2 mb-1">
        <PanelTitle className="m-0">{t('line.requests_title')}</PanelTitle>
        {count > 0 && (
          <span className="min-w-6 h-6 px-1.5 rounded-full bg-terracotta text-white text-[13px] font-semibold inline-flex items-center justify-center tabular-nums"
            aria-label={String(count)}>{count}</span>
        )}
      </div>
      <LoadState loading={loading && !data} error={error} onRetry={reload}>
        {count === 0 ? <Desc className="m-0">{t('line.requests_empty')}</Desc> : (
          <>
            <Desc className="mt-0 mb-3">{t('line.requests_hint')}</Desc>
            <ul className="list-none p-0 m-0 flex flex-col gap-3">
              {data!.map((req) => {
                const room = roomOf(req.room_number_typed);
                const tenant = room?.current?.tenants ?? null;
                const elsewhere = linkedTo(req.line_user_id);
                const otherLine = tenant?.line_user_id && tenant.line_user_id !== req.line_user_id ? tenant.line_display_name || '?' : null;
                return (
                  <li key={req.id} className="border border-line rounded p-3">
                    <div className="flex items-center gap-3">
                      {req.line_picture_url
                        ? <img src={req.line_picture_url} alt="" className="w-11 h-11 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
                        : <span className="w-11 h-11 rounded-full bg-line shrink-0" aria-hidden />}
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate">{req.line_display_name || '—'}</div>
                        <div className="text-[13px] text-ink-soft">
                          {t('line.typed_room', { n: req.room_number_typed })}
                          {tenant && <> · {t('line.room_tenant', { label: tenantLabel(req.room_number_typed, tenant) })}</>}
                        </div>
                      </div>
                    </div>
                    {!tenant && <AlertBar kind="warn">{t('line.no_tenant_in_room', { n: req.room_number_typed })}</AlertBar>}
                    {elsewhere && elsewhere.number !== req.room_number_typed && (
                      <AlertBar kind="warn">{t('line.linked_elsewhere', { label: tenantLabel(elsewhere.number, elsewhere.current?.tenants) })}</AlertBar>
                    )}
                    {otherLine && <AlertBar kind="warn">{t('line.tenant_has_other', { name: otherLine })}</AlertBar>}
                    <BtnRow className="mt-3">
                      <Btn small disabled={!tenant || busy !== null} onClick={() => void decide(req, 'approve')}>{t('line.approve')}</Btn>
                      <Btn small variant="secondary" disabled={busy !== null} onClick={() => void decide(req, 'reject')}>{t('line.reject')}</Btn>
                    </BtnRow>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </LoadState>
      {done && <ApprovedDialog result={done} onClose={() => setDone(null)} />}
    </Panel>
  );
}

/** After approving: the name staff must give this chat in LINE OA Manager, with a Copy button. */
function ApprovedDialog({ result, onClose }: { result: LineDecision; onClose: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const name = result.label ?? result.room_number;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(name);
      setCopied(true);
    } catch {
      // Clipboard blocked (old phone browser): select the text so it can be copied by hand.
      const el = document.getElementById('oa-name');
      if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s?.removeAllRanges(); s?.addRange(r); }
    }
  };

  return (
    <Modal onClose={onClose} className="max-w-[460px]">
      <ModalClose onClick={onClose} />
      <h2 className="text-xl mt-0">{t('line.approved_title', { n: result.room_number })}</h2>
      {result.pushed ? <Desc>{t('line.pushed')}</Desc> : <AlertBar kind="warn">{t('line.push_failed', { e: result.push_error ?? '' })}</AlertBar>}
      {result.previous_room && <Desc>{t('line.moved_from', { room: result.previous_room })}</Desc>}
      <div className="text-[12px] uppercase tracking-wide text-muted">{t('line.oa_name')}</div>
      <div className="flex items-center gap-3 mt-1 mb-4">
        <span id="oa-name" className="font-display text-2xl font-semibold select-all">{name}</span>
        <Btn small variant="secondary" onClick={() => void copy()}>{copied ? t('common.copied') : t('common.copy')}</Btn>
      </div>
      <div className="text-[12px] uppercase tracking-wide text-muted">{t('line.line_name')}</div>
      <div className="mt-1 mb-4 font-semibold">{result.line_display_name || '—'}</div>
      <Desc>{t('line.oa_steps')}</Desc>
      <BtnRow><Btn onClick={onClose}>{t('common.ok')}</Btn></BtnRow>
    </Modal>
  );
}
