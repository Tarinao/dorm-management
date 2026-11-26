import { useNavigate, useParams } from 'react-router';
import { getBookingReceipt } from '../lib/api';
import { useI18n, type TKey } from '../lib/i18n';
import { useLoad } from '../lib/useLoad';
import { LoadState } from '../components/common';
import { IconPrinter } from '../components/icons';
import { Btn, BtnRow, Empty } from '../components/ui';

/** Printable receipt for a booking fee (B-000001). Same layout as the payment receipt. */
export default function BookingReceipt() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { t, money, date } = useI18n();
  const { data, error, loading, reload } = useLoad(() => getBookingReceipt(id), [id]);

  return (
    <LoadState loading={loading && !data} error={error} onRetry={reload}>
      {data === null ? <Empty>{t('res.receipt_not_found')}</Empty> : data && (() => {
        const { reservation: r, settings } = data;
        return (
          <>
            <BtnRow className="no-print mb-4">
              <Btn variant="secondary" onClick={() => navigate(-1)}>{t('common.back')}</Btn>
              <Btn onClick={() => window.print()}><IconPrinter size={17} />{t('receipt.print')}</Btn>
            </BtnRow>
            <div className="print-area bg-white text-black border border-line rounded max-w-[560px] p-6 sm:p-8 text-[14px]">
              <div className="text-center mb-5">
                <div className="font-display text-xl font-semibold">{settings.dorm_name}</div>
                <div className="text-[18px] font-semibold mt-1">{t('res.receipt_title')}</div>
              </div>
              <div className="flex justify-between gap-4 flex-wrap mb-4">
                <div>{t('receipt.no')} <strong className="tabular-nums">{r.booking_receipt_no}</strong></div>
                <div>{t('receipt.date')} <strong>{date(r.booking_fee_paid_on)}</strong></div>
              </div>
              <div className="mb-1">{t('receipt.received_from')} <strong>{r.guest_name}</strong>{r.phone && <> · {r.phone}</>}</div>
              <div className="mb-4">{t('res.receipt_for', { n: r.rooms?.number ?? '—', date: date(r.desired_move_in) })}</div>
              <div className="flex justify-between gap-4 py-2 text-[17px] font-semibold border-t border-b border-black/30">
                <span>{t('res.f.fee')}</span><span className="tabular-nums">{money(r.booking_fee)}</span>
              </div>
              <div className="mt-2">{t('receipt.method')}: {r.booking_fee_method ? t(`pay.${r.booking_fee_method}` as TKey) : '—'}</div>
              <div className="mt-2 text-[13px]">{t('res.receipt_note')}</div>
              {r.note && <div className="mt-1">{t('common.notes')}: {r.note}</div>}
              <div className="mt-12 flex justify-end">
                <div className="text-center w-[220px]">
                  <div className="border-b border-black/60 h-8" />
                  <div className="text-[13px] mt-1">{t('receipt.received_by')}</div>
                </div>
              </div>
            </div>
          </>
        );
      })()}
    </LoadState>
  );
}
