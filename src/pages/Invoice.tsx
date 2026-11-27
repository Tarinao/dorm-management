import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { getInvoice, getPublicInvoice } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useLoad } from '../lib/useLoad';
import { LoadState } from '../components/common';
import { IconPrinter } from '../components/icons';
import { InvoiceView } from '../components/InvoiceView';
import { Btn, Empty } from '../components/ui';

/** In the app (logged in): the printable invoice of one bill, from the Billing page or a room. */
export default function Invoice() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const { data, error, loading, reload } = useLoad(() => getInvoice(id), [id]);

  return (
    <div className="invoice-page">
      <div className="invoice-toolbar">
        <Btn variant="secondary" onClick={() => navigate(-1)}>{t('common.back')}</Btn>
        <Btn disabled={!data} onClick={() => window.print()}><IconPrinter size={17} />{t('invoice.print')}</Btn>
      </div>
      <LoadState loading={loading && !data} error={error} onRetry={reload}>
        {data === null ? <Empty>{t('invoice.not_found')}</Empty> : data && <InvoiceView data={data} />}
      </LoadState>
    </div>
  );
}

/** The read-only page the LINE "View invoice" link opens (no login): #/i/<token>. The token is
 *  checked by the "invoice" Edge Function, which returns only that one bill. */
export function PublicInvoice() {
  const { token = '' } = useParams();
  const { t } = useI18n();
  const { data, error, loading } = useLoad(() => getPublicInvoice(token), [token]);

  useEffect(() => {   // keep the page out of search engines (the whole site also sends noindex)
    const meta = document.createElement('meta');
    meta.name = 'robots'; meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    const before = document.title;
    document.title = t('invoice.page_title');
    return () => { meta.remove(); document.title = before; };
  }, [t]);

  return (
    <div className="invoice-page">
      {loading && !data ? <Empty>{t('common.loading')}</Empty>
        : error || !data ? (
          <div className="max-w-[480px] mx-auto bg-white text-black rounded p-6 text-center">
            <p className="m-0 font-semibold">ไม่พบใบแจ้งหนี้ หรือลิงก์หมดอายุแล้ว</p>
            <p className="mt-1 mb-0">This invoice link is not valid or has expired.</p>
            <p className="mt-3 mb-0 text-[14px]">กรุณาติดต่อสำนักงานหอพัก / Please contact the dorm office.</p>
          </div>
        ) : (
          <>
            <div className="invoice-toolbar">
              <Btn onClick={() => window.print()}><IconPrinter size={17} />พิมพ์ / Print</Btn>
            </div>
            <InvoiceView data={data} />
          </>
        )}
    </div>
  );
}
