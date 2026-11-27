/* invoice: the data for ONE bill's read-only invoice, for the "View invoice" link in the LINE bill.
 *
 * Deployed with verify_jwt = false: the tenant opening the link is not logged in. The link carries
 * an unguessable token (32 random bytes); only its SHA-256 is stored, in public.invoice_links, with
 * an expiry (90 days). A wrong, unknown or expired token gets the same 404, and the answer only
 * ever contains the bill that token was made for.
 *
 * The page itself is the app's public route #/i/<token> (Edge Functions on supabase.co cannot
 * serve HTML), which posts the token here and draws the invoice from the answer.
 *
 * POST { token }  ->  200 InvoiceData (see src/lib/invoice.ts)  |  400 BAD_REQUEST  |  404 NOT_FOUND
 *
 * Runs with the service role (no user): reads the bill, its extras, the tenant, the dorm settings
 * and the logo from the private "branding" bucket (sent back as a data: URL). */
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';
import { hashToken, isToken } from '../_shared/invoicelink.ts';

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...HEADERS, 'Content-Type': 'application/json' } });

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const BILL_COLS = 'id, invoice_no, month, rent_month, usage_month, room_number, contract_id, rent, common_fee, ' +
  'water_people, water_per_person, water_amount, elec_prev, elec_curr, elec_units, elec_amount, total, due_date, created_at, note, issued_by_name';
const SETTINGS_COLS = 'dorm_name, dorm_name_en, address, tax_id, office_phone, email, line_oa_id, invoice_note, ' +
  'bank_name, bank_branch, bank_account_name, bank_account_number, promptpay_id, logo_path';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: HEADERS });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  let token: unknown = null;
  try { token = ((await req.json()) as { token?: unknown }).token; } catch { /* checked below */ }
  if (!isToken(token)) return json({ error: 'BAD_REQUEST' }, 400);

  try {
    const { data: link, error: le } = await db.from('invoice_links').select('bill_id, expires_at')
      .eq('token_hash', await hashToken(token)).maybeSingle();
    if (le) throw new Error(le.message);
    if (!link || Date.parse(link.expires_at) <= Date.now()) return json({ error: 'NOT_FOUND' }, 404);

    const [billR, extrasR, settingsR] = await Promise.all([
      db.from('bill_summary').select(BILL_COLS).eq('id', link.bill_id).maybeSingle(),
      db.from('bill_extras').select('label, amount').eq('bill_id', link.bill_id).order('created_at'),
      db.from('settings').select(SETTINGS_COLS).eq('id', 1).single(),
    ]);
    for (const r of [billR, extrasR, settingsR]) if (r.error) throw new Error(r.error.message);
    const bill = billR.data as unknown as Record<string, unknown> | null;
    if (!bill) return json({ error: 'NOT_FOUND' }, 404);
    const s = settingsR.data as unknown as Record<string, string | null>;

    let tenant: { full_name: string; address: string; phone: string } | null = null;
    if (bill.contract_id) {
      const { data } = await db.from('contracts').select('tenants(full_name, address, phone)').eq('id', bill.contract_id as string).maybeSingle();
      const t = (data as { tenants: { full_name: string; address: string; phone: string } | null } | null)?.tenants;
      if (t) tenant = { full_name: t.full_name ?? '', address: t.address ?? '', phone: t.phone ?? '' };
    }

    const { contract_id: _omit, ...billOut } = bill;
    return json({
      bill: billOut,
      extras: extrasR.data ?? [],
      tenant,
      dorm: {
        name: s.dorm_name ?? '', name_en: s.dorm_name_en ?? '', address: s.address ?? '', tax_id: s.tax_id ?? '',
        phone: s.office_phone ?? '', email: s.email ?? '', line_oa_id: s.line_oa_id ?? '', invoice_note: s.invoice_note ?? '',
        bank_name: s.bank_name ?? '', bank_branch: s.bank_branch ?? '', bank_account_name: s.bank_account_name ?? '',
        bank_account_number: s.bank_account_number ?? '', promptpay_id: s.promptpay_id ?? '',
        logo: s.logo_path ? await logoDataUrl(s.logo_path) : null,
      },
    });
  } catch (e) {
    console.error('invoice failed:', e instanceof Error ? e.message : String(e));
    return json({ error: 'FAILED' }, 500);
  }
});

/** The logo from the private bucket as a data: URL (null if it cannot be read). */
async function logoDataUrl(path: string): Promise<string | null> {
  const { data, error } = await db.storage.from('branding').download(path);
  if (error || !data) { console.error('invoice: logo not read:', error?.message); return null; }
  const type = ['image/png', 'image/jpeg', 'image/webp'].includes(data.type) ? data.type : 'image/png';
  const bytes = new Uint8Array(await data.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}
