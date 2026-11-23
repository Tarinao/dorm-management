/* Toast messages and a confirm dialog (native alert/confirm are unreliable in phone webviews). */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Btn, BtnRow, Modal } from '../components/ui';
import { useI18n } from './i18n';

interface ConfirmOpts { title: string; body?: string; confirmLabel?: string; danger?: boolean }

interface Feedback {
  toast: (msg: string, kind?: 'ok' | 'error') => void;
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
}

const Ctx = createContext<Feedback | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: 'ok' | 'error' }[]>([]);
  const [dialog, setDialog] = useState<ConfirmOpts | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const nextId = useRef(1);

  const toast = useCallback((msg: string, kind: 'ok' | 'error' = 'ok') => {
    const id = nextId.current++;
    setToasts((ts) => [...ts, { id, msg, kind }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3000);
  }, []);

  const confirm = useCallback((opts: ConfirmOpts) => new Promise<boolean>((resolve) => {
    resolver.current = resolve;
    setDialog(opts);
  }), []);

  const answer = (v: boolean) => { resolver.current?.(v); resolver.current = null; setDialog(null); };

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {dialog && (
        <Modal onClose={() => answer(false)} className="max-w-[400px]">
          <h2 className="text-xl mt-0 mb-1">{dialog.title}</h2>
          {dialog.body && <p className="text-[14px] text-ink-soft mt-2 mb-5">{dialog.body}</p>}
          <BtnRow className="mt-4">
            <Btn variant={dialog.danger ? 'dangerSolid' : 'primary'} onClick={() => answer(true)}>
              {dialog.confirmLabel ?? (dialog.danger ? t('common.yes_delete') : t('common.save'))}
            </Btn>
            <Btn variant="secondary" onClick={() => answer(false)}>{dialog.danger ? t('common.keep') : t('common.cancel')}</Btn>
          </BtnRow>
        </Modal>
      )}
      {toasts.length > 0 && (
        <div className="no-print fixed bottom-[calc(76px_+_env(safe-area-inset-bottom,0px))] md:bottom-6 left-1/2 -translate-x-1/2 z-[90] flex flex-col gap-2 items-center w-full px-4 pointer-events-none">
          {toasts.map((x) => (
            <div key={x.id} role="status"
              className={`px-[18px] py-[11px] rounded-3xl text-[14px] shadow-[0_4px_18px_rgba(0,0,0,0.22)] max-w-[440px] text-center ${x.kind === 'error' ? 'bg-terracotta text-white' : 'bg-ink text-paper'}`}>
              {x.msg}
            </div>
          ))}
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useFeedback(): Feedback {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFeedback must be used inside <FeedbackProvider>');
  return v;
}
