import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { AlertBar, Btn, Field } from '../components/ui';
import { Logo } from '../components/icons';

export function LogoutButton() {
  const { t } = useI18n();
  const { signOut } = useAuth();
  return <Btn variant="secondary" onClick={() => void signOut()}>{t('common.logout')}</Btn>;
}

export default function Login() {
  const { t, lang, setLang } = useI18n();
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    setBusy(true); setError('');
    const err = await signIn(String(f.get('email') ?? ''), String(f.get('password') ?? ''));
    setBusy(false);
    if (err) setError(/invalid login/i.test(err) ? t('login.failed') : err);
  };

  return (
    <div lang={lang} className="min-h-screen flex items-center justify-center p-5">
      <form onSubmit={onSubmit} className="bg-paper-raised border border-line rounded p-6 max-w-[380px] w-full">
        <div className="flex items-center justify-between mb-4">
          <span className="font-display text-[19px] font-semibold flex items-center gap-2"><Logo size={26} className="text-teal" /> {t('app.name')}</span>
          <button type="button" onClick={() => setLang(lang === 'th' ? 'en' : 'th')}
            className="px-2.5 py-1 rounded border border-line bg-transparent text-[13px]">{lang === 'th' ? 'EN' : 'ไทย'}</button>
        </div>
        <h2 className="text-lg mt-0 mb-3">{t('login.title')}</h2>
        {error && <AlertBar kind="warn">{error}</AlertBar>}
        <Field label={t('login.email')} className="mb-3">
          <input name="email" type="email" required autoComplete="username" />
        </Field>
        <Field label={t('login.password')} className="mb-5">
          <input name="password" type="password" required autoComplete="current-password" />
        </Field>
        <Btn type="submit" disabled={busy} className="w-full justify-center">{busy ? '…' : t('login.submit')}</Btn>
      </form>
    </div>
  );
}
