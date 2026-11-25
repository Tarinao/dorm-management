/* "How to use" guide for workers. Every text is an [English, Thai] pair, so a section or step
 * can never exist in one language only (checked by the type and by scripts/test-guide.ts). */

export type Pair = readonly [en: string, th: string];
export interface GuideSection { id: string; title: Pair; intro: Pair; steps: readonly Pair[]; tip?: Pair }

export const GUIDE: readonly GuideSection[] = [
  {
    id: 'check-in',
    title: ['Check-in (new tenant)', 'ทำสัญญา / ย้ายเข้า'],
    intro: ['Do this on the day the tenant moves in, with the tenant next to you.', 'ทำในวันที่ผู้เช่าย้ายเข้า โดยมีผู้เช่าอยู่ด้วย'],
    steps: [
      ['Open "Rooms" and tap the empty room (grey house with the door open).', 'เปิดหน้า "ห้องพัก" แล้วแตะห้องที่ว่าง (บ้านสีเทาประตูเปิด)'],
      ['Tap "Check in a tenant".', 'แตะปุ่ม "ทำสัญญา / ย้ายเข้า"'],
      ['Tenant: type the full name (required), phone, ID card / passport reference and an emergency contact.', 'ข้อมูลผู้เช่า: กรอกชื่อ-นามสกุล (ต้องกรอก) เบอร์โทร เลขบัตรประชาชน/พาสปอร์ต และผู้ติดต่อฉุกเฉิน'],
      ['Contract: check the start date, add the end date if there is one, and type the deposit received.', 'สัญญา: ตรวจวันเริ่มสัญญา ใส่วันสิ้นสุดถ้ามี และกรอกเงินประกันที่รับไว้'],
      ['Type how many people will live in the room. Rent and water price come from the room; only the owner can change them.', 'กรอกจำนวนคนที่จะอยู่ในห้อง ค่าเช่าและค่าน้ำใช้ตามที่ตั้งไว้ในห้อง เฉพาะเจ้าของหอเท่านั้นที่เปลี่ยนได้'],
      ['Read the electric meter in the room and type the number. The first bill counts from this number.', 'จดเลขมิเตอร์ไฟในห้องแล้วกรอกตัวเลข บิลแรกจะคิดจากเลขนี้'],
      ['Tap "Check in". The room becomes a green house (Occupied).', 'แตะ "ยืนยันย้ายเข้า" ห้องจะเปลี่ยนเป็นบ้านสีเขียว (มีผู้เช่า)'],
    ],
    tip: ['If the room says "Maintenance", make sure it is ready first.', 'ถ้าห้องอยู่ในสถานะ "ซ่อมบำรุง" ให้ตรวจว่าห้องพร้อมก่อน'],
  },
  {
    id: 'meters',
    title: ['Entering meter readings', 'จดมิเตอร์'],
    intro: ['Once a month, near the end of the month. Only the electric meter is read; water is charged per person.', 'เดือนละครั้ง ช่วงสิ้นเดือน จดเฉพาะมิเตอร์ไฟ ค่าน้ำคิดเป็นรายคน ไม่ต้องจดมิเตอร์น้ำ'],
    steps: [
      ['Open "Meters".', 'เปิดหน้า "จดมิเตอร์"'],
      ['Check the month and the reading date at the top of the page.', 'ตรวจเดือนและวันที่จดด้านบนของหน้า'],
      ['Go to each room, read the electric meter and type the number into that room’s card.', 'เดินไปทีละห้อง อ่านเลขมิเตอร์ไฟ แล้วกรอกในการ์ดของห้องนั้น'],
      ['Look at "Used": it should look normal. If the number is lower than last time a red warning appears; read the meter again.', 'ดูช่อง "ใช้ไป" ว่าดูปกติ ถ้าเลขน้อยกว่าครั้งก่อนจะมีคำเตือนสีแดง ให้อ่านมิเตอร์อีกครั้ง'],
      ['Tap "Save". The card gets a green tick.', 'แตะ "บันทึก" การ์ดจะมีเครื่องหมายถูกสีเขียว'],
      ['Tap "Not recorded yet" to see the rooms that are left.', 'แตะ "ยังไม่ได้จด" เพื่อดูห้องที่เหลือ'],
    ],
    tip: ['Vacant rooms can be recorded too ("All rooms"). No bill is made for them.', 'ห้องว่างก็จดได้ (แตะ "ทุกห้อง") ระบบจะไม่ออกบิลให้ห้องว่าง'],
  },
  {
    id: 'bills',
    title: ['Generating the monthly bills', 'ออกบิลประจำเดือน'],
    intro: ['After all meters for the month are saved.', 'ทำหลังจากจดมิเตอร์ครบทุกห้องแล้ว'],
    steps: [
      ['Open "Billing" and choose the month.', 'เปิดหน้า "ออกบิล" แล้วเลือกเดือน'],
      ['Check the preview. Each room shows "Ready" or a reason in red, e.g. "No meter reading this month".', 'ตรวจตัวอย่างบิล แต่ละห้องจะขึ้น "พร้อมออกบิล" หรือเหตุผลสีแดง เช่น "ยังไม่จดมิเตอร์เดือนนี้"'],
      ['Fix the red reasons first (usually: go to "Meters" and save the missing number).', 'แก้เหตุผลสีแดงก่อน (ส่วนใหญ่คือไปหน้า "จดมิเตอร์" แล้วบันทึกเลขที่ขาด)'],
      ['Owner only: change a room’s water price, people or rent here if needed. It is remembered for next month.', 'เฉพาะเจ้าของหอ: เปลี่ยนค่าน้ำ จำนวนคน หรือค่าเช่าของห้องได้ตรงนี้ ระบบจะจำไว้ใช้เดือนถัดไป'],
      ['Tap "Generate N bills" and confirm. Rooms that already have a bill are skipped.', 'แตะ "ออกบิล N ห้อง" แล้วยืนยัน ห้องที่มีบิลแล้วจะถูกข้าม'],
      ['To add a charge (e.g. parking), tap "+ Add charge" on that bill.', 'ถ้ามีค่าใช้จ่ายเพิ่ม (เช่น ค่าจอดรถ) แตะ "+ เพิ่มรายการ" ที่บิลนั้น'],
    ],
    tip: ['Bills are due on the due day of the following month. A wrong bill can be deleted by the owner (only before any payment) and made again.', 'บิลครบกำหนดตามวันที่ตั้งไว้ของเดือนถัดไป ถ้าบิลผิด เจ้าของหอลบแล้วออกใหม่ได้ (เฉพาะบิลที่ยังไม่มีการชำระ)'],
  },
  {
    id: 'payment',
    title: ['Recording a payment', 'รับชำระเงิน'],
    intro: ['Every time a tenant pays, in cash or by transfer.', 'ทุกครั้งที่ผู้เช่าจ่ายเงิน ทั้งเงินสดและโอน'],
    steps: [
      ['Open "Payments" (or the room page, or the bill on "Billing").', 'เปิดหน้า "รับชำระ" (หรือหน้าห้อง หรือบิลในหน้า "ออกบิล")'],
      ['Find the room’s bill and tap "Record payment".', 'หาบิลของห้องนั้น แล้วแตะ "รับชำระเงิน"'],
      ['The amount is filled with the full balance. If the tenant pays less, type the amount received; the bill becomes "Partly paid".', 'ระบบใส่ยอดค้างทั้งหมดให้ ถ้าผู้เช่าจ่ายไม่ครบ ให้แก้เป็นจำนวนที่ได้รับจริง บิลจะเป็น "ชำระบางส่วน"'],
      ['Check the date and choose Cash or Transfer. For a transfer, check the money has arrived first.', 'ตรวจวันที่ แล้วเลือก เงินสด หรือ โอน ถ้าโอน ให้ตรวจว่าเงินเข้าแล้วก่อน'],
      ['Tap "Save payment". The receipt opens with its receipt number.', 'แตะ "บันทึกการชำระ" ใบเสร็จจะเปิดขึ้นพร้อมเลขที่ใบเสร็จ'],
      ['Tap "Print" (or save as PDF) and give the receipt to the tenant.', 'แตะ "พิมพ์" (หรือบันทึกเป็น PDF) แล้วมอบใบเสร็จให้ผู้เช่า'],
    ],
    tip: ['The "Overdue" tab and the Dashboard show rooms that are late. You cannot record more than the balance.', 'แท็บ "เกินกำหนด" และหน้า "ภาพรวม" แสดงห้องที่ค้างชำระ ระบบไม่ให้บันทึกเกินยอดค้าง'],
  },
  {
    id: 'check-out',
    title: ['Check-out (tenant leaves)', 'ย้ายออก'],
    intro: ['On the day the tenant gives back the room.', 'ทำในวันที่ผู้เช่าคืนห้อง'],
    steps: [
      ['Check the room’s bills on the room page; collect anything still unpaid.', 'ตรวจบิลของห้องในหน้าห้อง เก็บเงินที่ยังค้างให้ครบ'],
      ['Open the room and tap "Check out".', 'เปิดหน้าห้อง แล้วแตะ "ย้ายออก"'],
      ['Enter the move-out date and read the electric meter one last time.', 'กรอกวันที่ย้ายออก และจดเลขมิเตอร์ไฟครั้งสุดท้าย'],
      ['Type how much deposit you give back, and a note for any damage or deductions.', 'กรอกจำนวนเงินประกันที่คืน และหมายเหตุความเสียหายหรือการหักเงิน'],
      ['Choose the room status after: Vacant, Maintenance or Reserved. Tap "Confirm check-out".', 'เลือกสถานะห้องหลังย้ายออก: ว่าง ซ่อมบำรุง หรือ จองแล้ว แล้วแตะ "ยืนยันย้ายออก"'],
      ['For the last bill, open "Billing" for the move-out month and generate it, then record the payment.', 'บิลสุดท้าย: เปิดหน้า "ออกบิล" ของเดือนที่ย้ายออกแล้วออกบิล จากนั้นรับชำระเงิน'],
    ],
  },
];
