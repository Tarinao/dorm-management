import { useRef, useState, type FormEvent } from 'react';
import {
  getLineInfo, getSettings, knownLineAccounts, listProfiles, logoUrl, removeLogo, saveLineInfo, setProfileName, setRole, updateSettings, uploadLogo,
  type LineInfo, type Profile, type Settings as SettingsRow,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFeedback } from '../lib/feedback';
import { parseNum } from '../lib/format';
import { friendlyError, useI18n, type TKey } from '../lib/i18n';
import { useLoad } from '../lib/useLoad';
import { LoadState, NumInput } from '../components/common';
import { Btn, DataTable, Desc, Field, FormGrid, PageHead, Panel, PanelTitle } from '../components/ui';

/** Admin only (guarded in App.tsx and enforced by RLS). */
export default function Settings() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useLoad(async () => {
    const [settings, profiles, lineAccounts, lineInfo] = await Promise.all([getSettings(), listProfiles(), knownLineAccounts(), getLineInfo()]);
    return { settings, profiles, lineAccounts, lineInfo, logo: await logoUrl(settings.logo_path) };
  }, []);

  return (
    <>
      <PageHead title={t('settings.title')} sub={t('settings.subtitle')} />
      <LoadState loading={loading && !data} error={error} onRetry={reload}>
        {data && (
          <>
            <RatesForm key={data.settings.updated_at} s={data.settings} onSaved={reload} />
            <InvoiceForm key={'inv' + data.settings.updated_at} s={data.settings} logo={data.logo} onSaved={reload} />
            <PaymentForm key={'pay' + data.settings.updated_at} s={data.settings} lineAccounts={data.lineAccounts} onSaved={reload} />
            <LineInfoForm key={'li' + data.settings.updated_at + data.lineInfo.map((x) => x.updated_at).join()} s={data.settings} info={data.lineInfo} onSaved={reload} />
            <StaffList profiles={data.profiles} onSaved={reload} />
          </>
        )}
      </LoadState>
    </>
  );
}

function RatesForm({ s, onSaved }: { s: SettingsRow; onSaved: () => void }) {
  const { t } = useI18n();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);

  const save = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const wOld = parseNum(f.get('water_price_old')), wNew = parseNum(f.get('water_price_new'));
    const elec = parseNum(f.get('electric_rate')), due = parseNum(f.get('due_day')), common = parseNum(f.get('common_fee'));
    const name = String(f.get('dorm_name') ?? '').trim();
    if (!name || wOld === null || wOld < 0 || wNew === null || wNew < 0 || elec === null || elec < 0 || due === null || !Number.isInteger(due) || due < 1 || due > 28
        || common === null || common < 0) {
      toast(t('err.check'), 'error'); return;
    }
    setBusy(true);
    try {
      await updateSettings({ dorm_name: name, water_price_old: wOld, water_price_new: wNew, electric_rate: elec, due_day: due, common_fee: common });
      toast(t('common.saved'));
      onSaved();
    } catch (e) { toast(friendlyError(e, t), 'error'); } finally { setBusy(false); }
  };

  return (
    <Panel>
      <form onSubmit={save}>
        <FormGrid>
          <Field label={t('settings.dorm_name')}><input name="dorm_name" required defaultValue={s.dorm_name} /></Field>
          <Field label={t('settings.water_price_old')} hint={t('settings.water_hint')}>
            <NumInput name="water_price_old" required defaultValue={s.water_price_old} />
          </Field>
          <Field label={t('settings.water_price_new')}><NumInput name="water_price_new" required defaultValue={s.water_price_new} /></Field>
          <Field label={t('settings.electric_rate')}><NumInput name="electric_rate" required defaultValue={s.electric_rate} /></Field>
          <Field label={t('settings.common_fee')} hint={t('settings.common_fee_hint')}><NumInput name="common_fee" required defaultValue={s.common_fee} /></Field>
          <Field label={t('settings.due_day')} hint={t('settings.due_day_hint')}>
            <input name="due_day" type="number" min={1} max={28} step={1} required defaultValue={s.due_day} />
          </Field>
        </FormGrid>
        <Desc>{t('settings.rates_note')}</Desc>
        <Btn type="submit" disabled={busy}>{busy ? t('common.saving') : t('settings.save')}</Btn>
      </form>
    </Panel>
  );
}

/** PromptPay / bank / office details that tenants receive on LINE. Values are typed in here by
 *  the owner only; nothing is pre-filled from code. */
function PaymentForm({ s, lineAccounts, onSaved }: {
  s: SettingsRow; lineAccounts: { line_user_id: string; name: string }[]; onSaved: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);

  const save = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const v = (k: string) => String(f.get(k) ?? '').trim();
    const digits = (k: string) => v(k).replace(/[\s-]/g, '');
    const promptpay = digits('promptpay_id');
    const account = v('bank_account_number').replace(/\s/g, '');
    if ((promptpay && !/^(0\d{9}|\d{13})$/.test(promptpay)) || !/^[0-9-]*$/.test(account)) {
      toast(t('err.check'), 'error'); return;
    }
    setBusy(true);
    try {
      await updateSettings({
        promptpay_id: promptpay, bank_name: v('bank_name'), bank_branch: v('bank_branch'),
        bank_account_name: v('bank_account_name'), bank_account_number: account,
        office_location: v('office_location'), office_hours: v('office_hours'),
        auto_send_enabled: f.get('auto_send_enabled') === 'on',
        // Only sent when changed, so the other fields can be saved on their own.
        ...((v('summary_line_user_id') || null) !== (s.summary_line_user_id ?? null)
          ? { summary_line_user_id: v('summary_line_user_id') || null } : {}),
      });
      toast(t('common.saved'));
      onSaved();
    } catch (e) { toast(friendlyError(e, t), 'error'); } finally { setBusy(false); }
  };

  return (
    <Panel>
      <PanelTitle>{t('settings.pay_title')}</PanelTitle>
      <Desc>{t('settings.pay_hint')}</Desc>
      <form onSubmit={save}>
        <FormGrid>
          <Field label={t('settings.promptpay_id')} hint={t('settings.promptpay_hint')}>
            <input name="promptpay_id" inputMode="numeric" autoComplete="off" defaultValue={s.promptpay_id} />
          </Field>
          <Field label={t('settings.bank_name')}><input name="bank_name" autoComplete="off" defaultValue={s.bank_name} /></Field>
          <Field label={t('settings.bank_branch')}><input name="bank_branch" autoComplete="off" defaultValue={s.bank_branch} /></Field>
          <Field label={t('settings.bank_account_name')}><input name="bank_account_name" autoComplete="off" defaultValue={s.bank_account_name} /></Field>
          <Field label={t('settings.bank_account_number')}>
            <input name="bank_account_number" inputMode="numeric" autoComplete="off" defaultValue={s.bank_account_number} />
          </Field>
          <Field label={t('settings.office_hours')}><input name="office_hours" autoComplete="off" defaultValue={s.office_hours} /></Field>
          <Field label={t('settings.office_location')} className="col-span-full">
            <textarea name="office_location" rows={2} defaultValue={s.office_location} />
          </Field>
        </FormGrid>
        <label className="flex items-start gap-2.5 mb-1 text-[14.5px]">
          <input type="checkbox" name="auto_send_enabled" defaultChecked={s.auto_send_enabled} className="mt-1 w-5 h-5" />
          <span>{t('settings.auto_send')}</span>
        </label>
        <Desc className="ml-[30px] mt-0 mb-4">{t('settings.auto_send_hint')}</Desc>
        <Field label={t('settings.summary_line')} hint={t('settings.summary_line_hint')} className="mb-4 max-w-[480px]">
          <select name="summary_line_user_id" defaultValue={s.summary_line_user_id ?? ''}>
            <option value="">{t('settings.summary_none')}</option>
            {s.summary_line_user_id && !lineAccounts.some((a) => a.line_user_id === s.summary_line_user_id) && (
              <option value={s.summary_line_user_id}>{s.summary_line_user_id.slice(0, 8)}…</option>
            )}
            {lineAccounts.map((a) => <option key={a.line_user_id} value={a.line_user_id}>{a.name}</option>)}
          </select>
        </Field>
        <Btn type="submit" disabled={busy}>{busy ? t('common.saving') : t('settings.pay_save')}</Btn>
      </form>
    </Panel>
  );
}

function StaffList({ profiles, onSaved }: { profiles: Profile[]; onSaved: () => void }) {
  const { t } = useI18n();
  const { profile: me } = useAuth();
  const { toast } = useFeedback();

  const rename = async (p: Profile, name: string) => {
    try {
      await setProfileName(p.id, name);
      toast(t('common.saved'));
      onSaved();
    } catch (e) { toast(friendlyError(e, t), 'error'); }
  };

  const change = async (p: Profile, value: string) => {
    try {
      await setRole(p.id, value === 'admin' || value === 'staff' ? value : null);
      toast(t('settings.role_saved'));
      onSaved();
    } catch (e) { toast(friendlyError(e, t), 'error'); }
  };

  return (
    <Panel>
      <PanelTitle>{t('settings.staff_title')}</PanelTitle>
      <Desc>{t('settings.staff_hint')}</Desc>
      <DataTable>
        <thead><tr><th>{t('login.email')}</th><th>{t('common.name')}</th><th>{t('settings.role')}</th></tr></thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.id}>
              <td className="break-all">{p.email} {p.id === me?.id && <span className="text-muted">{t('settings.you')}</span>}</td>
              <td>
                <input aria-label={t('common.name')} defaultValue={p.full_name} maxLength={100} placeholder={t('settings.staff_name_ph')}
                  onBlur={(e) => { if (e.target.value.trim() !== p.full_name) void rename(p, e.target.value); }} />
              </td>
              <td>
                {/* You cannot remove your own admin access, so the dorm is never left without an owner. */}
                <select value={p.role ?? ''} disabled={p.id === me?.id} onChange={(e) => void change(p, e.target.value)}>
                  <option value="">{t('settings.role_none')}</option>
                  <option value="staff">{t('settings.role_staff')}</option>
                  <option value="admin">{t('settings.role_admin')}</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </Panel>
  );
}

/** The line_info rows (same keys as the table's check constraint and INFO_KEYS in _shared/bot.ts). */
const INFO_KEYS = ['room_types', 'facilities', 'location', 'house_rules', 'deposit_terms'] as const;

/** What the LINE bot answers under "Dorm information", in Thai and English, plus the office
 *  phone and the map pin. Nothing is hardcoded in the bot: empty = "not available yet". */
function LineInfoForm({ s, info, onSaved }: { s: SettingsRow; info: LineInfo[]; onSaved: () => void }) {
  const { t } = useI18n();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const of = (k: string) => info.find((x) => x.key === k);

  const save = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const v = (k: string) => String(f.get(k) ?? '').trim();
    // A pasted "13.7563, 100.5018" in the latitude box fills both.
    let latText = v('location_lat'), lngText = v('location_lng');
    const pair = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(latText);
    if (pair) { latText = pair[1]; lngText = pair[2]; }
    const lat = latText ? Number(latText) : null, lng = lngText ? Number(lngText) : null;
    if ((lat === null) !== (lng === null) || (lat !== null && (!Number.isFinite(lat) || Math.abs(lat) > 90)) ||
        (lng !== null && (!Number.isFinite(lng) || Math.abs(lng) > 180))) {
      toast(t('err.check'), 'error'); return;
    }
    setBusy(true);
    try {
      await updateSettings({ office_phone: v('office_phone'), location_lat: lat, location_lng: lng });
      await saveLineInfo(INFO_KEYS.map((k) => ({ key: k, text_th: v(`${k}_th`), text_en: v(`${k}_en`) })));
      toast(t('common.saved'));
      onSaved();
    } catch (e) { toast(friendlyError(e, t), 'error'); } finally { setBusy(false); }
  };

  return (
    <Panel>
      <PanelTitle>{t('li.title')}</PanelTitle>
      <Desc>{t('li.hint')}</Desc>
      <form onSubmit={save}>
        {INFO_KEYS.map((k) => (
          <fieldset key={k} className="border border-line rounded p-3 mb-4">
            <legend className="px-1 text-[13.5px] font-semibold">{t(`li.key.${k}` as TKey)}</legend>
            {k === 'location' && <Desc className="mt-0 mb-2">{t('li.location_hint')}</Desc>}
            <div className="grid grid-cols-2 max-[640px]:grid-cols-1 gap-3">
              <Field label={t('li.th')}><textarea name={`${k}_th`} rows={4} maxLength={4500} defaultValue={of(k)?.text_th ?? ''} /></Field>
              <Field label={t('li.en')}><textarea name={`${k}_en`} rows={4} maxLength={4500} defaultValue={of(k)?.text_en ?? ''} /></Field>
            </div>
          </fieldset>
        ))}
        <FormGrid>
          <Field label={t('li.office_phone')} hint={t('li.office_hours_note')}>
            <input name="office_phone" type="tel" inputMode="tel" maxLength={40} autoComplete="off" defaultValue={s.office_phone} />
          </Field>
          <Field label={t('li.lat')} hint={t('li.pin_hint')}>
            <input name="location_lat" inputMode="decimal" autoComplete="off" defaultValue={s.location_lat ?? ''} />
          </Field>
          <Field label={t('li.lng')}><input name="location_lng" inputMode="decimal" autoComplete="off" defaultValue={s.location_lng ?? ''} /></Field>
        </FormGrid>
        <Btn type="submit" disabled={busy}>{busy ? t('common.saving') : t('li.save')}</Btn>
      </form>
    </Panel>
  );
}

/** What the printed invoice shows about the dorm. Nothing is hardcoded: every value is typed here.
 *  The phone on the invoice is the office phone (LINE info below); bank and PromptPay come from
 *  the payment details. The logo is kept in a private bucket. */
function InvoiceForm({ s, logo, onSaved }: { s: SettingsRow; logo: string | null; onSaved: () => void }) {
  const { t } = useI18n();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const v = (k: string) => String(f.get(k) ?? '').trim();
    const oa = v('line_oa_id');
    if ((v('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('email'))) || (oa && !/^@?[A-Za-z0-9._-]{2,40}$/.test(oa))) {
      toast(t('err.check'), 'error'); return;
    }
    setBusy(true);
    try {
      await updateSettings({
        dorm_name_en: v('dorm_name_en'), address: v('address'), tax_id: v('tax_id'), email: v('email'),
        line_oa_id: oa && !oa.startsWith('@') ? '@' + oa : oa, invoice_note: v('invoice_note'),
      });
      toast(t('common.saved'));
      onSaved();
    } catch (e) { toast(friendlyError(e, t), 'error'); } finally { setBusy(false); }
  };

  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      toast(t('settings.logo_bad'), 'error'); return;
    }
    setBusy(true);
    try {
      await uploadLogo(file, s.logo_path);
      toast(t('common.saved'));
      onSaved();
    } catch (e) { toast(friendlyError(e, t), 'error'); } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const dropLogo = async () => {
    if (!s.logo_path) return;
    setBusy(true);
    try { await removeLogo(s.logo_path); onSaved(); } catch (e) { toast(friendlyError(e, t), 'error'); } finally { setBusy(false); }
  };

  return (
    <Panel>
      <PanelTitle>{t('settings.invoice_title')}</PanelTitle>
      <Desc>{t('settings.invoice_hint')}</Desc>
      <div className="flex items-center gap-4 flex-wrap mb-4">
        {logo
          ? <img src={logo} alt={t('settings.logo')} className="w-20 h-20 object-contain border border-line rounded bg-white" />
          : <div className="w-20 h-20 border border-dashed border-line rounded flex items-center justify-center text-[12px] text-muted">{t('settings.no_logo')}</div>}
        <div className="flex flex-col gap-2">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void pickLogo(e.target.files?.[0])} />
          <Btn small variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>{logo ? t('settings.logo_change') : t('settings.logo_upload')}</Btn>
          {logo && <Btn small variant="danger" disabled={busy} onClick={() => void dropLogo()}>{t('settings.logo_remove')}</Btn>}
          <span className="text-[12px] text-muted">{t('settings.logo_hint')}</span>
        </div>
      </div>
      <form onSubmit={save}>
        <FormGrid>
          <Field label={t('settings.dorm_name_th')}><input value={s.dorm_name} readOnly disabled /></Field>
          <Field label={t('settings.dorm_name_en')}><input name="dorm_name_en" maxLength={200} defaultValue={s.dorm_name_en} /></Field>
          <Field label={t('settings.address')} className="col-span-full"><textarea name="address" rows={2} maxLength={500} defaultValue={s.address} /></Field>
          <Field label={t('settings.tax_id')} hint={t('common.optional')}><input name="tax_id" maxLength={40} defaultValue={s.tax_id} /></Field>
          <Field label={t('settings.email')}><input name="email" type="email" maxLength={200} defaultValue={s.email} /></Field>
          <Field label={t('settings.line_oa_id')} hint={t('settings.line_oa_hint')}><input name="line_oa_id" maxLength={41} placeholder="@yourdorm" defaultValue={s.line_oa_id} /></Field>
          <Field label={t('settings.invoice_phone')}><input value={s.office_phone} readOnly disabled /></Field>
          <Field label={t('settings.invoice_note')} className="col-span-full"><textarea name="invoice_note" rows={2} maxLength={1000} defaultValue={s.invoice_note} /></Field>
        </FormGrid>
        <Btn type="submit" disabled={busy}>{busy ? t('common.saving') : t('settings.invoice_save')}</Btn>
      </form>
    </Panel>
  );
}
