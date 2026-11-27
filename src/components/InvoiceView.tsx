import { bahtText, ddmmyyyy, invoiceFooter, invoiceLines, money2, type InvoiceData } from '../lib/invoice';
import '../invoice.css';

/** One A4 invoice (ใบแจ้งหนี้), Thai with English. Every dorm detail comes from Settings; the
 *  common fee line uses the bill's own stored fee. Used in the app and on the public LINE page. */
export function InvoiceView({ data }: { data: InvoiceData }) {
  const { bill: b, tenant, dorm: d } = data;
  const lines = invoiceLines(data);
  const note = [d.invoice_note, b.note].filter((x) => x && x.trim()).join('\n');

  return (
    <div className="invoice-sheet" lang="th">
      <div className="inv-head">
        <div className="inv-dorm">
          {d.logo && <img className="inv-logo" src={d.logo} alt="" />}
          <div className="inv-dorm-text">
            {d.name && <div className="inv-dorm-name">{d.name}</div>}
            {d.name_en && <div className="inv-dorm-name-en">{d.name_en}</div>}
            {d.address && <div className="inv-small" style={{ whiteSpace: 'pre-line' }}>{d.address}</div>}
            {d.tax_id && <div className="inv-small">เลขประจำตัวผู้เสียภาษี (Tax ID): {d.tax_id}</div>}
            {(d.phone || d.email) && (
              <div className="inv-small">
                {d.phone && <>โทร (Tel.) {d.phone}</>}{d.phone && d.email && ' · '}{d.email && <>อีเมล (Email) {d.email}</>}
              </div>
            )}
          </div>
        </div>
        <div className="inv-title">
          <h1>ใบแจ้งหนี้ (Invoice)</h1>
          <div className="inv-original">ต้นฉบับ (Original)</div>
          <table className="inv-meta">
            <tbody>
              <tr><td>เลขที่ (No.)</td><td>{b.invoice_no}</td></tr>
              <tr><td>วันที่ (Date)</td><td>{ddmmyyyy(b.created_at)}</td></tr>
              <tr><td>ห้อง (Room)</td><td>{b.room_number}</td></tr>
              <tr><td>ผู้ออก (Issued by)</td><td>{b.issued_by_name || '—'}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <hr className="inv-rule" />

      <div className="inv-customer">
        <h2>ลูกค้า (Customer)</h2>
        <div><b>{tenant?.full_name || '—'}</b></div>
        {tenant?.address && <div style={{ whiteSpace: 'pre-line' }}>{tenant.address}</div>}
        {tenant?.phone && <div>โทร (Tel.) {tenant.phone}</div>}
      </div>

      <table className="inv-table">
        <thead>
          <tr><th className="no"><span className="inv-wide">ลำดับ</span>(#)</th><th>รายการชำระ (Description)</th><th className="amt">ราคา(Price)</th></tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.no}><td className="no">{l.no}</td><td>{l.text}</td><td className="amt">{money2(l.amount)}</td></tr>
          ))}
        </tbody>
      </table>

      <div className="inv-total">
        <div className="inv-total-words">({bahtText(Number(b.total))})</div>
        <div className="inv-total-right">
          <span className="inv-total-label">จำนวนเงินรวมทั้งสิ้น (Total amount)</span>
          <span className="inv-total-amount">{money2(Number(b.total))}</span>
        </div>
      </div>

      <div className="inv-note"><b>หมายเหตุ (Note)</b>{note ? <div>{note}</div> : null}</div>

      <div className="inv-sign">
        <div>
          <div>ลงชื่อ ...................................................... ผู้วางบิล</div>
          <div className="inv-small">(Biller)</div>
        </div>
      </div>

      <div className="inv-grow" />

      <div className="inv-footer">
        {invoiceFooter(data).map((line, i) => <p key={i}>{line}</p>)}
      </div>
    </div>
  );
}
