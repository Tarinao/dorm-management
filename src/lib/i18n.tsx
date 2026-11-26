/* Thai / English text. Every key holds BOTH languages side by side ([en, th]), so a
 * missing translation is a type error, not a blank label on a worker's phone.
 * Placeholders look like {name} and are filled by t('key', { name: 'x' }). */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { dateLabel, money, monthLabel, type Lang } from './format';

const D = {
  // ---- common
  'app.name': ['Dorm Manager', 'ระบบจัดการหอพัก'],
  'common.loading': ['Loading…', 'กำลังโหลด…'],
  'common.save': ['Save', 'บันทึก'],
  'common.saving': ['Saving…', 'กำลังบันทึก…'],
  'common.saved': ['Saved', 'บันทึกแล้ว'],
  'common.cancel': ['Cancel', 'ยกเลิก'],
  'common.close': ['Close', 'ปิด'],
  'common.delete': ['Delete', 'ลบ'],
  'common.edit': ['Edit', 'แก้ไข'],
  'common.back': ['← Back', '← ย้อนกลับ'],
  'common.yes_delete': ['Yes, delete', 'ใช่ ลบเลย'],
  'common.keep': ['No, keep it', 'ไม่ เก็บไว้'],
  'common.confirm_title': ['Please confirm', 'โปรดยืนยัน'],
  'common.optional': ['optional', 'ไม่บังคับ'],
  'common.all': ['All', 'ทั้งหมด'],
  'common.none': ['—', '—'],
  'common.logout': ['Log out', 'ออกจากระบบ'],
  'common.language': ['ภาษาไทย', 'English'],
  'common.month': ['Month', 'เดือน'],
  'common.date': ['Date', 'วันที่'],
  'common.notes': ['Notes', 'หมายเหตุ'],
  'common.room': ['Room', 'ห้อง'],
  'common.room_n': ['Room {n}', 'ห้อง {n}'],
  'common.floor': ['Floor', 'ชั้น'],
  'common.floor_n': ['Floor {n}', 'ชั้น {n}'],
  'common.status': ['Status', 'สถานะ'],
  'common.rent': ['Rent', 'ค่าเช่า'],
  'common.deposit': ['Deposit', 'เงินประกัน'],
  'common.phone': ['Phone', 'เบอร์โทร'],
  'common.name': ['Name', 'ชื่อ'],
  'common.total': ['Total', 'รวม'],
  'common.water': ['Water', 'น้ำ'],
  'common.electric': ['Electric', 'ไฟ'],
  'common.units': ['units', 'หน่วย'],
  'common.retry': ['Try again', 'ลองอีกครั้ง'],

  // ---- statuses
  'status.vacant': ['Vacant', 'ว่าง'],
  'status.occupied': ['Occupied', 'มีผู้เช่า'],
  'status.reserved': ['Reserved', 'จองแล้ว'],
  'status.maintenance': ['Maintenance', 'ซ่อมบำรุง'],
  'status.paid': ['Paid', 'ชำระแล้ว'],
  'status.partial': ['Partly paid', 'ชำระบางส่วน'],
  'status.unpaid': ['Unpaid', 'ยังไม่ชำระ'],
  'status.overdue': ['Overdue', 'เกินกำหนด'],

  // ---- navigation
  'nav.dashboard': ['Dashboard', 'ภาพรวม'],
  'nav.rooms': ['Rooms', 'ห้องพัก'],
  'nav.meters': ['Meters', 'จดมิเตอร์'],
  'nav.billing': ['Billing', 'ออกบิล'],
  'nav.bills': ['Payments', 'รับชำระ'],
  'nav.guide': ['How to use', 'วิธีใช้งาน'],
  'nav.settings': ['Settings', 'ตั้งค่า'],

  // ---- login / access
  'login.title': ['Log in', 'เข้าสู่ระบบ'],
  'login.email': ['Email', 'อีเมล'],
  'login.password': ['Password', 'รหัสผ่าน'],
  'login.submit': ['Log in', 'เข้าสู่ระบบ'],
  'login.failed': ['Wrong email or password.', 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'],
  'access.waiting_title': ['Waiting for approval', 'รอการอนุมัติ'],
  'access.waiting_body': [
    'Your account ({email}) exists but has no role yet. Ask the owner to give you access in Settings → Staff accounts.',
    'บัญชีของคุณ ({email}) ยังไม่ได้รับสิทธิ์ใช้งาน กรุณาให้เจ้าของหอเปิดสิทธิ์ที่ ตั้งค่า → บัญชีพนักงาน',
  ],
  'access.admin_only': ['Only the owner (admin) can open this page.', 'หน้านี้สำหรับเจ้าของหอ (ผู้ดูแลระบบ) เท่านั้น'],

  // ---- rooms list
  'rooms.title': ['Rooms', 'ห้องพัก'],
  'rooms.subtitle': ['{n} rooms · tap a room to see the tenant, contract and history', '{n} ห้อง · แตะที่ห้องเพื่อดูผู้เช่า สัญญา และประวัติ'],
  'rooms.no_tenant': ['No tenant', 'ไม่มีผู้เช่า'],
  'rooms.until': ['until {date}', 'ถึง {date}'],
  'rooms.search': ['Search room or tenant', 'ค้นหาห้องหรือชื่อผู้เช่า'],
  'rooms.empty': ['No rooms match.', 'ไม่พบห้องที่ตรงกัน'],

  // ---- room detail
  'room.details': ['Room details', 'ข้อมูลห้อง'],
  'room.status_hint': ['"Occupied" is set automatically by move-in and move-out.', 'สถานะ "มีผู้เช่า" ระบบจะตั้งให้เองเมื่อย้ายเข้า/ย้ายออก'],
  'room.save': ['Save room', 'บันทึกข้อมูลห้อง'],
  'room.current': ['Current tenant', 'ผู้เช่าปัจจุบัน'],
  'room.no_current': ['Nobody lives here right now.', 'ตอนนี้ห้องนี้ว่าง ไม่มีผู้เช่า'],
  'room.move_in': ['Check in a tenant', 'ทำสัญญา / ย้ายเข้า'],
  'room.move_out': ['Check out', 'ย้ายออก'],
  'room.tenant': ['Tenant', 'ผู้เช่า'],
  'room.contract': ['Contract', 'สัญญาเช่า'],
  'room.history': ['Past tenants', 'ผู้เช่าเก่า'],
  'room.history_empty': ['No past tenants.', 'ยังไม่มีผู้เช่าเก่า'],
  'room.readings': ['Recent meter readings', 'ค่ามิเตอร์ล่าสุด'],
  'room.readings_empty': ['No readings yet.', 'ยังไม่มีการจดมิเตอร์'],
  'room.kind.move_in': ['Move-in', 'ย้ายเข้า'],
  'room.kind.monthly': ['Monthly', 'ประจำเดือน'],
  'room.kind.move_out': ['Move-out', 'ย้ายออก'],
  'room.save_tenant': ['Save tenant', 'บันทึกข้อมูลผู้เช่า'],
  'room.save_contract': ['Save contract', 'บันทึกสัญญา'],
  'room.not_found': ['Room not found.', 'ไม่พบห้องนี้'],

  // ---- tenant & contract fields
  'f.full_name': ['Full name', 'ชื่อ-นามสกุล'],
  'f.phone': ['Phone', 'เบอร์โทรศัพท์'],
  'f.id_card_ref': ['ID card / passport reference', 'เลขบัตรประชาชน / พาสปอร์ต (อ้างอิง)'],
  'f.id_card_hint': ['Free text, e.g. "ID card, last 4 digits 1234"', 'พิมพ์ได้อิสระ เช่น "บัตรประชาชน 4 ตัวท้าย 1234"'],
  'f.emergency_name': ['Emergency contact name', 'ชื่อผู้ติดต่อฉุกเฉิน'],
  'f.emergency_phone': ['Emergency contact phone', 'เบอร์ผู้ติดต่อฉุกเฉิน'],
  'f.start_date': ['Start date (move-in)', 'วันเริ่มสัญญา (วันย้ายเข้า)'],
  'f.end_date': ['End date', 'วันสิ้นสุดสัญญา'],
  'f.end_date_hint': ['Leave empty if open-ended. Needed before the next tenant can book the room.', 'เว้นว่างได้ถ้าไม่มีกำหนด ต้องใส่ก่อนจึงจะรับจองห้องให้ผู้เช่าคนถัดไปได้'],
  'f.monthly_rent': ['Monthly rent (฿)', 'ค่าเช่าต่อเดือน (บาท)'],
  'f.deposit': ['Deposit (฿)', 'เงินประกัน (บาท)'],
  'f.notes': ['Notes', 'หมายเหตุ'],

  // ---- room prices (remembered on the room for next month)
  'price.title': ['Prices for this room', 'ราคาของห้องนี้'],
  'price.hint': ['Kept for next month’s bills until you change them.', 'ระบบจำไว้ใช้กับบิลเดือนถัดไป จนกว่าจะเปลี่ยน'],
  'price.rent': ['Monthly rent (฿)', 'ค่าเช่าต่อเดือน (บาท)'],
  'price.water': ['Water price per person', 'ค่าน้ำต่อคน'],
  'price.water_old': ['Old customer {p}', 'ลูกค้าเก่า {p}'],
  'price.water_new': ['New customer {p}', 'ลูกค้าใหม่ {p}'],
  'price.water_other': ['Other {p}', 'อื่น ๆ {p}'],
  'price.people': ['People in room', 'จำนวนคนในห้อง'],
  'price.saved': ['Room {n}: prices saved for next month too.', 'ห้อง {n}: บันทึกราคาแล้ว ใช้ต่อเดือนถัดไปด้วย'],

  // ---- move in
  'movein.title': ['Check in a tenant — room {n}', 'ทำสัญญาย้ายเข้า — ห้อง {n}'],
  'movein.step_tenant': ['1. Tenant', '1. ข้อมูลผู้เช่า'],
  'movein.step_contract': ['2. Contract', '2. สัญญาเช่า'],
  'movein.step_meters': ['3. Electric meter on move-in day', '3. เลขมิเตอร์ไฟวันย้ายเข้า'],
  'movein.elec_start': ['Electric meter now', 'เลขมิเตอร์ไฟตอนนี้'],
  'movein.meters_hint': ['Read the electric meter before the tenant moves in. The first bill counts from this number.', 'จดเลขมิเตอร์ไฟก่อนผู้เช่าเข้าอยู่ บิลแรกจะคิดจากเลขนี้'],
  'movein.submit': ['Check in', 'ยืนยันย้ายเข้า'],
  'movein.done': ['Tenant checked in. Room {n} is now occupied.', 'ย้ายเข้าเรียบร้อย ห้อง {n} มีผู้เช่าแล้ว'],
  'movein.maintenance_warn': ['This room is in "Maintenance", so nobody can move in. Close its repair ticket (or set the room to Vacant under Room details) first.', 'ห้องนี้อยู่ในสถานะ "ซ่อมบำรุง" จึงย้ายเข้าไม่ได้ ต้องปิดงานซ่อม (หรือเปลี่ยนสถานะห้องเป็น "ว่าง" ในข้อมูลห้อง) ก่อน'],

  // ---- move out
  'moveout.title': ['Check out — room {n}', 'ย้ายออก — ห้อง {n}'],
  'moveout.intro': ['{name} is moving out. Read the electric meter one last time.', '{name} กำลังย้ายออก จดเลขมิเตอร์ไฟครั้งสุดท้าย'],
  'moveout.date': ['Move-out date', 'วันที่ย้ายออก'],
  'moveout.final_elec': ['Final electric meter', 'เลขมิเตอร์ไฟครั้งสุดท้าย'],
  'moveout.last_reading': ['Last reading: {e}', 'ครั้งก่อน: {e}'],
  'moveout.deposit_returned': ['Deposit returned (฿)', 'คืนเงินประกัน (บาท)'],
  'moveout.deposit_held': ['Deposit held: {amount}', 'เงินประกันที่เก็บไว้: {amount}'],
  'moveout.note': ['Note (damage, deductions…)', 'หมายเหตุ (ความเสียหาย หักเงิน ฯลฯ)'],
  'moveout.room_after': ['Room after move-out', 'สถานะห้องหลังย้ายออก'],
  'moveout.final_bill_hint': ['The final bill is made on the Billing page for the move-out month, from this reading.', 'บิลสุดท้ายออกได้ที่หน้า "ออกบิล" ของเดือนที่ย้ายออก โดยใช้เลขมิเตอร์นี้'],
  'moveout.submit': ['Confirm check-out', 'ยืนยันย้ายออก'],
  'moveout.done': ['Checked out. Room {n} is now {status}.', 'ย้ายออกเรียบร้อย ห้อง {n} เปลี่ยนเป็น "{status}"'],

  // ---- meters
  'meters.title': ['Meter readings', 'จดมิเตอร์'],
  'meters.subtitle': ['Enter this month’s electric meter number for each room. Water is charged per person, so its meter is not needed.', 'กรอกเลขมิเตอร์ไฟของเดือนนี้ทุกห้อง ค่าน้ำคิดต่อคน จึงไม่ต้องจดมิเตอร์น้ำ'],
  'meters.electric': ['Electric meter', 'มิเตอร์ไฟ'],
  'meters.show_occupied': ['Rooms with tenants ({n})', 'ห้องที่มีผู้เช่า ({n})'],
  'meters.show_all': ['All rooms ({n})', 'ทุกห้อง ({n})'],
  'meters.show_todo': ['Not recorded yet', 'ยังไม่ได้จด'],
  'meters.vacant_note': ['Vacant room: the number is kept, no bill is made.', 'ห้องว่าง: บันทึกเลขไว้ แต่ไม่ออกบิล'],
  'meters.need_number': ['Enter the meter number.', 'กรอกเลขมิเตอร์'],
  'meters.read_on': ['Reading date', 'วันที่จด'],
  'meters.progress': ['{done} of {total} rooms with tenants recorded', 'จดแล้ว {done} จาก {total} ห้องที่มีผู้เช่า'],
  'meters.prev': ['Last', 'ครั้งก่อน'],
  'meters.now': ['Now', 'ครั้งนี้'],
  'meters.used': ['Used', 'ใช้ไป'],
  'meters.saved_badge': ['Saved', 'บันทึกแล้ว'],
  'meters.save': ['Save', 'บันทึก'],
  'meters.update': ['Update', 'แก้ไข'],
  'meters.no_prev': ['No earlier reading', 'ไม่มีเลขครั้งก่อน'],
  'meters.backwards': ['Lower than last time — check the number.', 'เลขน้อยกว่าครั้งก่อน — ตรวจสอบอีกครั้ง'],
  'meters.empty': ['No rooms to show.', 'ไม่มีห้องที่จะแสดง'],
  'meters.billed_note': ['Already billed — changing it will not change the bill.', 'ออกบิลแล้ว — แก้เลขตอนนี้จะไม่เปลี่ยนบิล'],

  // ---- billing
  'billing.title': ['Monthly billing', 'ออกบิลประจำเดือน'],
  'billing.subtitle': ['Check the preview, then make all bills for the month in one go.', 'ตรวจสอบตัวอย่าง แล้วออกบิลทั้งเดือนในครั้งเดียว'],
  'billing.rates': ['Water per person: old customer {wo}, new customer {wn} · Electric {e}/unit · due on day {d} of next month', 'ค่าน้ำต่อคน: ลูกค้าเก่า {wo} ลูกค้าใหม่ {wn} · ค่าไฟ {e}/หน่วย · ครบกำหนดวันที่ {d} ของเดือนถัดไป'],
  'billing.rates_zero': ['The electric rate is 0. The owner should set it in Settings first.', 'ค่าไฟยังเป็น 0 เจ้าของหอควรตั้งที่หน้า ตั้งค่า ก่อน'],
  'billing.prices_hint': ['Choose each room’s water price, people and rent below. Changes are saved to the room and used again next month.', 'เลือกค่าน้ำ จำนวนคน และค่าเช่าของแต่ละห้องด้านล่าง ระบบบันทึกไว้ที่ห้องและใช้ต่อเดือนถัดไป'],
  'billing.water_col': ['Water (per person)', 'ค่าน้ำ (ต่อคน)'],
  'billing.people_col': ['People', 'คน'],
  'billing.preview': ['Preview — {month}', 'ตัวอย่างบิล — {month}'],
  'billing.generate': ['Generate {n} bills', 'ออกบิล {n} ห้อง'],
  'billing.generate_none': ['Nothing to generate', 'ไม่มีบิลที่ต้องออก'],
  'billing.generating': ['Generating…', 'กำลังออกบิล…'],
  'billing.confirm_title': ['Generate {n} bills for {month}?', 'ออกบิล {n} ห้อง ของเดือน{month}?'],
  'billing.confirm_body': ['Rents and rates are copied onto each bill now. Rooms that already have a bill are skipped.', 'ค่าเช่าและอัตราค่าน้ำไฟจะถูกบันทึกลงบิลตอนนี้ ห้องที่มีบิลแล้วจะถูกข้าม'],
  'billing.confirm_yes': ['Generate', 'ออกบิล'],
  'billing.result': ['{created} bills created, {skipped} rooms skipped.', 'ออกบิลแล้ว {created} ห้อง ข้าม {skipped} ห้อง'],
  'billing.outcome.created': ['Ready', 'พร้อมออกบิล'],
  'billing.outcome.already_billed': ['Already billed', 'ออกบิลแล้ว'],
  'billing.outcome.no_contract': ['No tenant', 'ไม่มีผู้เช่า'],
  'billing.outcome.no_reading': ['No meter reading this month', 'ยังไม่จดมิเตอร์เดือนนี้'],
  'billing.outcome.no_previous_reading': ['No earlier reading to compare', 'ไม่มีเลขมิเตอร์ครั้งก่อน'],
  'billing.outcome.meter_backwards': ['Meter lower than last time', 'เลขมิเตอร์น้อยกว่าครั้งก่อน'],
  'billing.bills_of': ['Bills — {month}', 'บิล — {month}'],
  'billing.no_bills': ['No bills for this month yet.', 'ยังไม่มีบิลของเดือนนี้'],
  'billing.water_line': ['Water {n} people × {r}', 'ค่าน้ำ {n} คน × {r}'],
  'billing.elec_line': ['Electric {u} units × {r}', 'ค่าไฟ {u} หน่วย × {r}'],
  'billing.meter_line': ['{prev} → {curr}', '{prev} → {curr}'],
  'billing.extras': ['Extra charges', 'ค่าใช้จ่ายเพิ่มเติม'],
  'billing.extra_label': ['What for', 'รายการ'],
  'billing.extra_label_ph': ['e.g. Parking, Cleaning', 'เช่น ค่าจอดรถ ค่าทำความสะอาด'],
  'billing.extra_amount': ['Amount (฿)', 'จำนวนเงิน (บาท)'],
  'billing.add_extra': ['+ Add charge', '+ เพิ่มรายการ'],
  'billing.remove_extra_title': ['Remove this charge?', 'ลบรายการนี้?'],
  'billing.delete_bill': ['Delete bill', 'ลบบิล'],
  'billing.delete_bill_title': ['Delete the bill for room {n}?', 'ลบบิลของห้อง {n}?'],
  'billing.delete_bill_body': ['Use this to fix a wrong bill: delete it, correct the reading, then generate again. Bills with payments cannot be deleted.', 'ใช้เมื่อบิลผิด: ลบบิล แก้เลขมิเตอร์ แล้วออกบิลใหม่ บิลที่มีการชำระเงินแล้วลบไม่ได้'],
  'billing.due': ['Due {date}', 'ครบกำหนด {date}'],
  'billing.open_room': ['Open room', 'ดูห้อง'],

  'billing.prices_hint_staff': ['Rent, water price and people come from each room. Only the owner can change them.', 'ค่าเช่า ค่าน้ำ และจำนวนคน ใช้ตามที่ตั้งไว้ในแต่ละห้อง เฉพาะเจ้าของหอเท่านั้นที่เปลี่ยนได้'],

  // ---- prices are admin-only
  'price.admin_only': ['Only the owner can change prices.', 'เฉพาะเจ้าของหอเท่านั้นที่เปลี่ยนราคาได้'],
  'price.summary': ['Rent {rent} · Water {w} × {n} people', 'ค่าเช่า {rent} · ค่าน้ำ {w} × {n} คน'],
  'movein.prices_from_room': ['Rent and water price come from the room. Only the owner can change them.', 'ค่าเช่าและค่าน้ำใช้ตามที่ตั้งไว้ในห้อง เฉพาะเจ้าของหอเท่านั้นที่เปลี่ยนได้'],

  // ---- payments
  'pay.title': ['Payments', 'รับชำระเงิน'],
  'pay.subtitle': ['Record what tenants pay and print receipts. Overdue bills are shown first.', 'บันทึกการชำระเงินและพิมพ์ใบเสร็จ บิลที่เกินกำหนดแสดงก่อน'],
  'pay.filter.overdue': ['Overdue', 'เกินกำหนด'],
  'pay.filter.open': ['Not fully paid', 'ยังชำระไม่ครบ'],
  'pay.filter.paid': ['Paid', 'ชำระแล้ว'],
  'pay.filter.all': ['All bills', 'ทุกบิล'],
  'pay.search': ['Search room or tenant', 'ค้นหาห้องหรือชื่อผู้เช่า'],
  'pay.record': ['Record payment', 'รับชำระเงิน'],
  'pay.dialog_title': ['Record payment — room {n}', 'รับชำระเงิน — ห้อง {n}'],
  'pay.bill_of': ['Bill for {month}', 'บิลเดือน{month}'],
  'pay.balance': ['Balance', 'ค้างชำระ'],
  'pay.paid_amount': ['Paid', 'ชำระแล้ว'],
  'pay.amount': ['Amount received (฿)', 'จำนวนเงินที่รับ (บาท)'],
  'pay.amount_hint': ['Less than the balance = partial payment', 'น้อยกว่ายอดค้าง = ชำระบางส่วน'],
  'pay.date': ['Payment date', 'วันที่ชำระ'],
  'pay.method': ['Method', 'ช่องทาง'],
  'pay.cash': ['Cash', 'เงินสด'],
  'pay.transfer': ['Transfer', 'โอนเงิน'],
  'pay.imported': ['Imported', 'นำเข้าจากระบบเก่า'],
  'pay.save': ['Save payment', 'บันทึกการชำระ'],
  'pay.done': ['Payment saved. Receipt {no}.', 'บันทึกแล้ว ใบเสร็จเลขที่ {no}'],
  'pay.too_much': ['More than the balance ({b}).', 'มากกว่ายอดค้าง ({b})'],
  'pay.history': ['Payments', 'ประวัติการชำระ'],
  'pay.receipt': ['Receipt', 'ใบเสร็จ'],
  'pay.delete_title': ['Delete payment {no}?', 'ลบการชำระ {no}?'],
  'pay.delete_body': ['Only for mistakes. The bill goes back to unpaid or partly paid, and the receipt becomes invalid.', 'ใช้เมื่อบันทึกผิดเท่านั้น บิลจะกลับเป็นยังไม่ชำระหรือชำระบางส่วน และใบเสร็จนี้จะใช้ไม่ได้'],
  'pay.empty': ['No bills in this list.', 'ไม่มีบิลในรายการนี้'],
  'pay.count': ['{n} bills · balance {amount}', '{n} บิล · ค้างชำระ {amount}'],
  'pay.room_bills': ['Bills and payments', 'บิลและการชำระเงิน'],
  'pay.room_bills_empty': ['No bills for this room yet.', 'ห้องนี้ยังไม่มีบิล'],
  'pay.show_older': ['Show older bills', 'แสดงบิลเก่า'],

  // ---- receipt
  'receipt.title': ['Receipt', 'ใบเสร็จรับเงิน'],
  'receipt.no': ['Receipt no.', 'เลขที่'],
  'receipt.date': ['Date', 'วันที่'],
  'receipt.received_from': ['Received from', 'ได้รับเงินจาก'],
  'receipt.for': ['Room {n} · {month}', 'ห้อง {n} · ประจำเดือน{month}'],
  'receipt.items': ['Bill items', 'รายการในบิล'],
  'receipt.bill_total': ['Bill total', 'ยอดรวมบิล'],
  'receipt.paid_before': ['Paid before', 'ชำระก่อนหน้านี้'],
  'receipt.this_payment': ['Amount received', 'จำนวนเงินที่ได้รับ'],
  'receipt.balance_after': ['Balance remaining', 'ยอดค้างคงเหลือ'],
  'receipt.method': ['Paid by', 'ชำระโดย'],
  'receipt.received_by': ['Received by', 'ผู้รับเงิน'],
  'receipt.print': ['Print', 'พิมพ์'],
  'receipt.not_found': ['Receipt not found.', 'ไม่พบใบเสร็จนี้'],

  // ---- dashboard
  'dash.title': ['Dashboard', 'ภาพรวม'],
  'dash.subtitle': ['Rooms and money at a glance.', 'สรุปห้องพักและการเงิน'],
  'dash.month': ['Bills of', 'บิลของเดือน'],
  'dash.occupancy': ['Occupancy', 'อัตราการเข้าพัก'],
  'dash.occupancy_foot': ['{o} of {t} rooms occupied', 'มีผู้เช่า {o} จาก {t} ห้อง'],
  'dash.expected': ['Expected', 'ยอดที่ต้องเก็บ'],
  'dash.expected_foot': ['{n} bills · {month}', '{n} บิล · {month}'],
  'dash.collected': ['Collected', 'เก็บได้แล้ว'],
  'dash.collected_foot': ['{p}% of expected', '{p}% ของยอดที่ต้องเก็บ'],
  'dash.outstanding': ['Outstanding', 'ค้างชำระทั้งหมด'],
  'dash.outstanding_foot': ['Unpaid balance, all months', 'ยอดค้างของทุกเดือน'],
  'dash.rooms_by_status': ['Rooms by status', 'ห้องตามสถานะ'],
  'dash.overdue_title': ['Rooms with overdue bills', 'ห้องที่ค้างชำระเกินกำหนด'],
  'dash.overdue_none': ['No overdue bills.', 'ไม่มีบิลค้างเกินกำหนด'],
  'dash.overdue_row': ['{n} bills · late since {date}', '{n} บิล · เกินกำหนดตั้งแต่ {date}'],
  'dash.overdue_total': ['Total overdue: {amount}', 'รวมค้างเกินกำหนด: {amount}'],
  'dash.open_payments': ['Open payments', 'ไปหน้ารับชำระ'],

  // ---- guide
  'guide.title': ['How to use', 'วิธีใช้งาน'],
  'guide.subtitle': ['Step-by-step help for daily work.', 'ขั้นตอนการใช้งานประจำวัน ทีละขั้น'],
  'guide.contents': ['Topics', 'หัวข้อ'],
  'guide.tip': ['Tip', 'เคล็ดลับ'],
  'guide.switch': ['อ่านเป็นภาษาไทย', 'Read in English'],

  // ---- settings
  'settings.title': ['Settings', 'ตั้งค่า'],
  'settings.subtitle': ['Rates and staff access. Only the owner can see this page.', 'อัตราค่าน้ำไฟและสิทธิ์พนักงาน เฉพาะเจ้าของหอเท่านั้น'],
  'settings.dorm_name': ['Dorm name (shown on receipts)', 'ชื่อหอพัก (แสดงบนใบเสร็จ)'],
  'settings.water_price_old': ['Water per person — old customer (฿)', 'ค่าน้ำต่อคน — ลูกค้าเก่า (บาท)'],
  'settings.water_price_new': ['Water per person — new customer (฿)', 'ค่าน้ำต่อคน — ลูกค้าใหม่ (บาท)'],
  'settings.water_hint': ['Each room picks one of these on the Billing page or room page.', 'แต่ละห้องเลือกราคาใดราคาหนึ่งได้ที่หน้า ออกบิล หรือหน้าห้อง'],
  'settings.electric_rate': ['Electric rate (฿ per unit)', 'ค่าไฟ (บาทต่อหน่วย)'],
  'settings.due_day': ['Payment due day', 'วันครบกำหนดชำระ'],
  'settings.due_day_hint': ['Day of the next month (1–28)', 'วันที่ของเดือนถัดไป (1–28)'],
  'settings.rates_note': ['New prices apply to bills generated from now on. Existing bills keep their prices. Changing a price here does not change rooms that already use the old number — update them on the Billing page.', 'ราคาใหม่ใช้กับบิลที่ออกหลังจากนี้ บิลเดิมไม่เปลี่ยน การแก้ราคาตรงนี้ไม่เปลี่ยนห้องที่ใช้ราคาเดิมอยู่แล้ว ให้แก้ที่หน้า ออกบิล'],
  'settings.save': ['Save settings', 'บันทึกการตั้งค่า'],
  'settings.staff_title': ['Staff accounts', 'บัญชีพนักงาน'],
  'settings.staff_hint': [
    'People sign up or are invited in the Supabase dashboard (Authentication → Users). They then appear here with no access until you choose a role.',
    'สร้างบัญชีหรือเชิญผู้ใช้ได้ที่ Supabase (Authentication → Users) แล้วบัญชีจะมาแสดงที่นี่ โดยยังใช้งานไม่ได้จนกว่าคุณจะเลือกสิทธิ์',
  ],
  'settings.role': ['Access', 'สิทธิ์'],
  'settings.role_none': ['No access', 'ไม่มีสิทธิ์'],
  'settings.role_staff': ['Staff', 'พนักงาน'],
  'settings.role_admin': ['Owner (admin)', 'เจ้าของ (ผู้ดูแลระบบ)'],
  'settings.you': ['(you)', '(คุณ)'],
  'settings.role_saved': ['Access updated.', 'อัปเดตสิทธิ์แล้ว'],

  // ---- errors
  'err.prefix': ['Not saved: ', 'บันทึกไม่สำเร็จ: '],
  'err.network': ['No internet connection. Try again.', 'เชื่อมต่ออินเทอร์เน็ตไม่ได้ ลองใหม่อีกครั้ง'],
  'err.permission': ['You do not have permission for this.', 'คุณไม่มีสิทธิ์ทำรายการนี้'],
  'err.room_busy': ['This room already has a tenant. Check them out first.', 'ห้องนี้มีผู้เช่าอยู่แล้ว ต้องทำย้ายออกก่อน'],
  'err.contract_not_active': ['This contract has already ended.', 'สัญญานี้สิ้นสุดไปแล้ว'],
  'err.overpay': ['The amount is more than the remaining balance.', 'จำนวนเงินมากกว่ายอดค้างชำระ'],
  'err.has_payments': ['This bill has payments, so it cannot be deleted.', 'บิลนี้มีการชำระเงินแล้ว จึงลบไม่ได้'],
  'err.duplicate': ['This already exists.', 'มีข้อมูลนี้อยู่แล้ว'],
  'err.check': ['Some values are not allowed. Check the numbers and dates.', 'มีค่าที่ไม่ถูกต้อง ตรวจสอบตัวเลขและวันที่อีกครั้ง'],
  'err.load': ['Could not load data.', 'โหลดข้อมูลไม่สำเร็จ'],

  // ---- nickname / LINE (0009)
  'common.ok': ['OK', 'ตกลง'],
  'common.copy': ['Copy', 'คัดลอก'],
  'common.copied': ['Copied', 'คัดลอกแล้ว'],
  'f.nickname': ['Nickname', 'ชื่อเล่น'],
  'f.nickname_hint': ['Shown as "101 (nickname)"', 'แสดงเป็น "101 (ชื่อเล่น)"'],
  'line.requests_title': ['LINE requests', 'คำขอเชื่อม LINE'],
  'line.requests_hint': [
    'Tenants who added the LINE OA and typed their room number. Approve only if the LINE name matches the tenant.',
    'ผู้เช่าที่เพิ่มเพื่อน LINE OA แล้วพิมพ์เลขห้อง อนุมัติเมื่อชื่อ LINE ตรงกับผู้เช่าเท่านั้น',
  ],
  'line.requests_empty': ['No requests waiting.', 'ไม่มีคำขอที่รออยู่'],
  'line.typed_room': ['Typed room {n}', 'พิมพ์ห้อง {n}'],
  'line.room_tenant': ['Tenant now: {label}', 'ผู้เช่าปัจจุบัน: {label}'],
  'line.no_tenant_in_room': ['Room {n} has no tenant now, so it cannot be approved.', 'ห้อง {n} ไม่มีผู้เช่าอยู่ จึงอนุมัติไม่ได้'],
  'line.linked_elsewhere': ['This LINE account is linked to {label} now. Approving moves it to this room.', 'บัญชี LINE นี้เชื่อมกับ {label} อยู่ หากอนุมัติจะย้ายมาห้องนี้'],
  'line.tenant_has_other': ['This tenant is already linked to LINE "{name}". Approving replaces it.', 'ผู้เช่านี้เชื่อมกับ LINE "{name}" อยู่แล้ว หากอนุมัติจะแทนที่'],
  'line.approve': ['Approve', 'อนุมัติ'],
  'line.reject': ['Reject', 'ปฏิเสธ'],
  'line.reject_title': ['Reject the request for room {n}?', 'ปฏิเสธคำขอของห้อง {n}?'],
  'line.reject_body': ['The person gets a polite message asking them to contact the office.', 'ระบบจะส่งข้อความสุภาพให้ติดต่อสำนักงาน'],
  'line.rejected': ['Request rejected', 'ปฏิเสธคำขอแล้ว'],
  'line.approved_title': ['Room {n} is linked to LINE', 'เชื่อมห้อง {n} กับ LINE แล้ว'],
  'line.oa_name': ['Name to set in LINE OA', 'ชื่อที่ต้องตั้งใน LINE OA'],
  'line.line_name': ['LINE name of the tenant', 'ชื่อ LINE ของผู้เช่า'],
  'line.oa_steps': [
    'In LINE OA Manager → Chats, find the chat with this LINE name and change its display name to the one above.',
    'ใน LINE OA Manager → แชท ให้หาแชทที่มีชื่อ LINE นี้ แล้วเปลี่ยนชื่อที่แสดงเป็นชื่อด้านบน',
  ],
  'line.pushed': ['The tenant got the confirmation message on LINE.', 'ผู้เช่าได้รับข้อความยืนยันทาง LINE แล้ว'],
  'line.push_failed': ['Saved, but the LINE message could not be sent: {e}', 'บันทึกแล้ว แต่ส่งข้อความ LINE ไม่สำเร็จ: {e}'],
  'line.moved_from': ['The link was moved from room {room}.', 'ย้ายการเชื่อมต่อมาจากห้อง {room}'],
  'line.status_linked': ['LINE: linked to "{name}"', 'LINE: เชื่อมกับ "{name}" แล้ว'],
  'line.status_not_linked': ['LINE: not linked. The tenant adds the LINE OA and types {n}.', 'LINE: ยังไม่เชื่อม ให้ผู้เช่าเพิ่มเพื่อน LINE OA แล้วพิมพ์ {n}'],
  'line.unlink': ['Unlink LINE', 'ยกเลิกการเชื่อม LINE'],
  'line.unlink_title': ['Unlink LINE from {label}?', 'ยกเลิกการเชื่อม LINE ของ {label}?'],
  'line.unlink_body': ['Bills will no longer be sent to this LINE account. Also rename or clear the chat in LINE OA Manager.', 'ระบบจะไม่ส่งบิลไปยัง LINE นี้อีก และควรเปลี่ยนชื่อหรือลบแชทใน LINE OA Manager ด้วย'],
  'line.unlinked': ['LINE unlinked', 'ยกเลิกการเชื่อม LINE แล้ว'],
  'line.moveout_title': ['Clear the LINE chat', 'จัดการแชท LINE'],
  'line.moveout_body': [
    '{label} was linked to LINE as "{name}". The link has been removed. In LINE OA Manager, rename or clear this chat so it is not mixed up with the next tenant.',
    '{label} เคยเชื่อม LINE ชื่อ "{name}" ระบบยกเลิกการเชื่อมแล้ว กรุณาเปลี่ยนชื่อหรือลบแชทนี้ใน LINE OA Manager เพื่อไม่ให้สับสนกับผู้เช่าคนถัดไป',
  ],
  'err.request_not_pending': ['This request was already handled. The list has been refreshed.', 'คำขอนี้ถูกจัดการไปแล้ว รายการถูกโหลดใหม่แล้ว'],
  'err.room_has_no_tenant': ['That room has no tenant now, so it cannot be linked.', 'ห้องนี้ไม่มีผู้เช่าอยู่ จึงเชื่อมไม่ได้'],
  'err.line_taken': ['This LINE account is already linked to another tenant.', 'บัญชี LINE นี้เชื่อมกับผู้เช่าคนอื่นอยู่แล้ว'],

  // ---- payment settings (0009)
  'settings.pay_title': ['Payment details for tenants', 'ข้อมูลการชำระเงินสำหรับผู้เช่า'],
  'settings.pay_hint': [
    'Sent to tenants on LINE when they choose how to pay. Staff can see them; only the owner can change them.',
    'ใช้ส่งให้ผู้เช่าทาง LINE เมื่อเลือกวิธีชำระเงิน พนักงานดูได้ แต่แก้ไขได้เฉพาะเจ้าของหอ',
  ],
  'settings.promptpay_id': ['PromptPay number', 'หมายเลขพร้อมเพย์'],
  'settings.promptpay_hint': ['10-digit phone (08…) or 13-digit ID, digits only', 'เบอร์โทร 10 หลัก (08…) หรือเลขบัตร 13 หลัก ตัวเลขเท่านั้น'],
  'settings.bank_name': ['Bank', 'ธนาคาร'],
  'settings.bank_branch': ['Branch', 'สาขา'],
  'settings.bank_account_name': ['Account name', 'ชื่อบัญชี'],
  'settings.bank_account_number': ['Account number', 'เลขที่บัญชี'],
  'settings.office_location': ['Office location (optional)', 'ที่ตั้งสำนักงาน (ไม่บังคับ)'],
  'settings.office_hours': ['Office hours', 'เวลาทำการ'],
  'settings.auto_send': ['Send bills on LINE automatically on the 1st of each month', 'ส่งบิลทาง LINE อัตโนมัติทุกวันที่ 1'],
  'settings.auto_send_hint': [
    'Off until you turn it on. When on: on the 1st at 08:00, last month\'s bills are made and sent to tenants on LINE; at 09:00 each day unpaid bills get a reminder (at most every 3 days).',
    'ปิดไว้จนกว่าจะเปิดเอง เมื่อเปิด: วันที่ 1 เวลา 08:00 ระบบจะสร้างบิลของเดือนก่อนและส่งให้ผู้เช่าทาง LINE และทุกวันเวลา 09:00 จะแจ้งเตือนบิลที่ยังไม่ชำระ (ไม่เกิน 1 ครั้งทุก 3 วัน)',
  ],
  'settings.pay_save': ['Save payment details', 'บันทึกข้อมูลการชำระเงิน'],

  // ---- bills on LINE (0010)
  'billing.line_send': ['Generate & send via LINE', 'สร้างบิลและส่งทาง LINE'],
  'billing.line_sending': ['Sending…', 'กำลังส่ง…'],
  'billing.line_confirm_title': ['Send the bills of {month} on LINE?', 'ส่งบิลเดือน {month} ทาง LINE?'],
  'billing.line_confirm_body': [
    'Bills that are ready are created first. Every tenant linked to LINE then gets their bill with payment buttons. A bill already sent is never sent again.',
    'ระบบจะสร้างบิลที่พร้อมก่อน แล้วส่งบิลพร้อมปุ่มเลือกวิธีชำระให้ผู้เช่าที่เชื่อม LINE แล้ว บิลที่ส่งไปแล้วจะไม่ส่งซ้ำ',
  ],
  'billing.line_send_yes': ['Send', 'ส่ง'],
  'billing.copy_msg': ['Copy message', 'คัดลอกข้อความ'],
  'billing.copied_msg': ['Message copied. Paste it in the tenant\'s chat.', 'คัดลอกแล้ว นำไปวางในแชทของผู้เช่าได้เลย'],
  'billing.line_sent_at': ['Sent on LINE {date}', 'ส่งทาง LINE แล้ว {date}'],
  'billing.line_not_sent': ['Not sent on LINE', 'ยังไม่ได้ส่งทาง LINE'],
  'billing.pay_choice': ['Tenant chose: {m}', 'ผู้เช่าเลือก: {m}'],
  'paymethod.promptpay': ['PromptPay QR', 'สแกน QR พร้อมเพย์'],
  'paymethod.transfer': ['Bank transfer', 'โอนเข้าบัญชี'],
  'paymethod.cash': ['Cash', 'จ่ายเป็นเงินสด'],
  'run.title': ['Sent on LINE: {month}', 'ส่งทาง LINE: {month}'],
  'run.last': ['Last LINE run: {date}', 'ส่งทาง LINE ล่าสุด: {date}'],
  'run.created': ['New bills', 'บิลใหม่'],
  'run.sent': ['Sent on LINE now', 'ส่งทาง LINE ครั้งนี้'],
  'run.already_sent': ['Sent before (not sent again)', 'ส่งไปแล้วก่อนหน้า (ไม่ส่งซ้ำ)'],
  'run.not_linked': ['Not on LINE: send by hand with "Copy message"', 'ยังไม่เชื่อม LINE: ส่งเองด้วย "คัดลอกข้อความ"'],
  'run.paid': ['Already paid', 'ชำระแล้ว'],
  'run.no_reading': ['No bill: meter not read', 'ไม่มีบิล: ยังไม่จดมิเตอร์'],
  'run.meter_backwards': ['No bill: meter lower than last month', 'ไม่มีบิล: เลขมิเตอร์น้อยกว่าเดือนก่อน'],
  'run.no_previous_reading': ['No bill: no earlier reading', 'ไม่มีบิล: ไม่มีเลขมิเตอร์เดือนก่อน'],
  'run.failed': ['Could not send', 'ส่งไม่สำเร็จ'],
  'run.none': ['none', 'ไม่มี'],
  'err.line_not_configured': ['LINE is not set up on the server (access token missing).', 'ยังไม่ได้ตั้งค่า LINE บนเซิร์ฟเวอร์ (ไม่มี access token)'],

  // ---- payment slips (0010)
  'slip.title': ['Slips to check', 'สลิปรอตรวจสอบ'],
  'slip.hint': [
    'Sent by tenants in the LINE chat. Check each one in your bank app first. A slip never marks a bill paid by itself.',
    'ผู้เช่าส่งมาทางแชท LINE กรุณาตรวจสอบยอดเงินในแอปธนาคารก่อน สลิปจะไม่ทำให้บิลเป็น "ชำระแล้ว" เอง',
  ],
  'slip.received': ['Slip received – check & confirm', 'ได้รับสลิป – ตรวจสอบและยืนยัน'],
  'slip.duplicate': ['สลิปซ้ำ / Duplicate slip', 'สลิปซ้ำ / Duplicate slip'],
  'slip.duplicate_of': ['Same QR as a slip received {date} ({status}).', 'QR เดียวกับสลิปที่ได้รับเมื่อ {date} ({status})'],
  'slip.status.pending': ['waiting', 'รอตรวจสอบ'],
  'slip.status.confirmed': ['confirmed', 'ยืนยันแล้ว'],
  'slip.status.rejected': ['not valid', 'ไม่ถูกต้อง'],
  'slip.no_qr': ['No QR found on this picture: check it by eye.', 'ไม่พบ QR ในรูปนี้ กรุณาตรวจสอบด้วยตา'],
  'slip.ref': ['Slip ref. {ref}', 'เลขอ้างอิงสลิป {ref}'],
  'slip.for_bill': ['For {month} · balance {b}', 'สำหรับเดือน {month} · คงค้าง {b}'],
  'slip.no_bill': ['This tenant has no unpaid bill.', 'ผู้เช่านี้ไม่มีบิลค้างชำระ'],
  'slip.received_at': ['Received {date} {time}', 'ได้รับเมื่อ {date} {time}'],
  'slip.confirm': ['Confirm & record payment', 'ยืนยันและบันทึกการชำระ'],
  'slip.confirm_title': ['Record the payment from this slip: room {n}', 'บันทึกการชำระจากสลิป: ห้อง {n}'],
  'slip.confirm_hint': ['Type the amount shown on the slip.', 'ใส่ยอดเงินตามสลิป'],
  'slip.reject': ['Not valid', 'ไม่ถูกต้อง'],
  'slip.reject_title': ['Mark this slip as not valid?', 'ยืนยันว่าสลิปนี้ไม่ถูกต้อง?'],
  'slip.reject_body': ['No payment is recorded. Contact the tenant if needed.', 'ระบบจะไม่บันทึกการชำระ ติดต่อผู้เช่าหากจำเป็น'],
  'slip.rejected': ['Slip marked not valid', 'บันทึกว่าสลิปไม่ถูกต้องแล้ว'],
  'slip.open': ['Open full size', 'เปิดรูปขนาดเต็ม'],
  'err.slip_not_pending': ['This slip was already handled. The list has been refreshed.', 'สลิปนี้ถูกจัดการไปแล้ว รายการถูกโหลดใหม่แล้ว'],
  'err.slip_has_no_bill': ['This slip is not linked to an unpaid bill.', 'สลิปนี้ไม่ได้ผูกกับบิลค้างชำระ'],

  // ---- settings: monthly summary on LINE (0010)
  'settings.summary_line': ['Send the monthly summary to this LINE account', 'ส่งสรุปบิลประจำเดือนไปที่บัญชี LINE นี้'],
  'settings.summary_line_hint': [
    'Lists rooms that got no bill (e.g. meter not read). Choose your own account; it appears here after it has messaged the LINE OA.',
    'แสดงห้องที่ไม่มีบิล (เช่น ยังไม่จดมิเตอร์) เลือกบัญชีของคุณเอง บัญชีจะแสดงที่นี่หลังจากเคยส่งข้อความหา LINE OA',
  ],
  'settings.summary_none': ['Do not send (see it in the app only)', 'ไม่ต้องส่ง (ดูในแอปเท่านั้น)'],

  // ---- reservations (0012)
  'nav.reservations': ['Reservations', 'การจอง'],
  'status.pending': ['Waiting to confirm', 'รอยืนยัน'],
  'status.confirmed': ['Confirmed', 'ยืนยันแล้ว'],
  'status.cancelled': ['Cancelled', 'ยกเลิก'],
  'status.expired': ['Expired', 'หมดอายุ'],
  'status.moved_in': ['Moved in', 'ย้ายเข้าแล้ว'],
  'res.title': ['Reservations', 'การจองห้อง'],
  'res.subtitle': ['Bookings and booking fees. A room can have only one active booking.', 'การจองและค่าจอง หนึ่งห้องมีการจองที่ยังไม่ปิดได้เพียงรายการเดียว'],
  'res.filter.active': ['Active', 'ยังไม่ปิด'],
  'res.filter.pending': ['Waiting to confirm', 'รอยืนยัน'],
  'res.filter.confirmed': ['Confirmed', 'ยืนยันแล้ว'],
  'res.filter.closed': ['Closed', 'ปิดแล้ว'],
  'res.filter.all': ['All', 'ทั้งหมด'],
  'res.new': ['New reservation', 'จองห้องใหม่'],
  'res.empty': ['No reservations in this list.', 'ไม่มีการจองในรายการนี้'],
  'res.room_none': ['No room chosen yet', 'ยังไม่ได้เลือกห้อง'],
  'res.move_in': ['Move-in {date}', 'ย้ายเข้า {date}'],
  'res.expires': ['expires {date}', 'หมดอายุ {date}'],
  'res.fee_paid': ['Booking fee {amount} paid {date}', 'ค่าจอง {amount} ชำระแล้ว {date}'],
  'res.fee_unpaid': ['Booking fee {amount} not paid yet', 'ค่าจอง {amount} ยังไม่ชำระ'],
  'res.no_fee': ['No booking fee', 'ไม่มีค่าจอง'],
  'res.from_line': ['From LINE', 'จาก LINE'],
  'res.line_hint': ['Asked in the LINE chat. Call the guest, choose a room, then confirm.', 'ขอผ่านแชท LINE โทรหาผู้จอง เลือกห้อง แล้วกดยืนยัน'],
  'res.confirm': ['Confirm', 'ยืนยันการจอง'],
  'res.confirmed_ok': ['Reservation confirmed', 'ยืนยันการจองแล้ว'],
  'res.need_room': ['Choose a room first (Edit).', 'ต้องเลือกห้องก่อน (แก้ไข)'],
  'res.cancel': ['Cancel booking', 'ยกเลิกการจอง'],
  'res.cancel_title': ['Cancel the reservation of {name}?', 'ยกเลิกการจองของ {name}?'],
  'res.cancel_body': ['The room becomes free for other bookings. A booking fee is not refunded automatically.', 'ห้องจะว่างให้จองได้อีกครั้ง ค่าจองจะไม่ถูกคืนอัตโนมัติ'],
  'res.cancelled_ok': ['Reservation cancelled', 'ยกเลิกการจองแล้ว'],
  'res.convert': ['Convert to move-in', 'ย้ายเข้าจากการจอง'],
  'res.receipt': ['Booking receipt', 'ใบเสร็จค่าจอง'],
  'res.delete_title': ['Delete this reservation?', 'ลบการจองนี้?'],
  'res.delete_body': ['Only for mistakes. To stop a booking, use "Cancel booking" instead.', 'ใช้เมื่อบันทึกผิดเท่านั้น ถ้าต้องการยกเลิกการจอง ให้ใช้ "ยกเลิกการจอง"'],
  'res.deleted': ['Reservation deleted', 'ลบการจองแล้ว'],
  'res.new_title': ['New reservation', 'จองห้องใหม่'],
  'res.edit_title': ['Reservation of {name}', 'การจองของ {name}'],
  'res.f.room': ['Room', 'ห้อง'],
  'res.f.room_pick': ['Choose a room', 'เลือกห้อง'],
  'res.f.guest_name': ['Guest name', 'ชื่อผู้จอง'],
  'res.f.desired': ['Desired move-in date', 'วันที่ต้องการย้ายเข้า'],
  'res.f.expires': ['Expires on', 'หมดอายุวันที่'],
  'res.f.expires_hint': ['Default 7 days after the move-in date. Not moved in by then = expired automatically.', 'ค่าเริ่มต้น 7 วันหลังวันย้ายเข้า ถ้ายังไม่ย้ายเข้า ระบบจะเปลี่ยนเป็นหมดอายุเอง'],
  'res.f.fee': ['Booking fee (฿)', 'ค่าจอง (บาท)'],
  'res.f.fee_paid_on': ['Fee paid on', 'วันที่รับค่าจอง'],
  'res.f.fee_hint': ['Leave empty while it is not paid.', 'เว้นว่างไว้ถ้ายังไม่ได้รับเงิน'],
  'res.f.method': ['Paid by', 'ชำระโดย'],
  'res.f.confirm_now': ['Confirm now (a vacant room becomes "Reserved")', 'ยืนยันทันที (ห้องว่างจะเปลี่ยนเป็น "จองแล้ว")'],
  'res.saved': ['Reservation saved', 'บันทึกการจองแล้ว'],
  'res.why.ROOM_ALREADY_RESERVED': ['already booked', 'มีการจองแล้ว'],
  'res.why.ROOM_IN_MAINTENANCE': ['blocked for maintenance', 'ปิดซ่อมบำรุง'],
  'res.why.ROOM_NO_MOVE_OUT_DATE': ['occupied, no move-out date', 'มีผู้เช่า ยังไม่มีวันย้ายออก'],
  'res.why.MOVE_IN_BEFORE_MOVE_OUT': ['occupied until a later date', 'ผู้เช่าปัจจุบันยังอยู่ถึงวันที่หลังจากนั้น'],
  'res.room_title': ['Reservation', 'การจอง'],
  'res.room_none_active': ['No active reservation.', 'ไม่มีการจองที่ยังไม่ปิด'],
  'res.reserve': ['Reserve this room', 'จองห้องนี้'],
  'res.cannot': ['Cannot be reserved now: {why}.', 'ยังจองไม่ได้: {why}'],
  'res.past': ['Earlier reservations', 'การจองก่อนหน้า'],
  'res.receipt_title': ['Booking fee receipt', 'ใบเสร็จรับเงินค่าจองห้อง'],
  'res.receipt_for': ['Booking of room {n}, move-in {date}', 'ค่าจองห้อง {n} วันย้ายเข้า {date}'],
  'res.receipt_note': ['This booking fee counts toward the deposit at move-in.', 'ค่าจองนี้นำไปหักเป็นส่วนหนึ่งของเงินประกันเมื่อย้ายเข้า'],
  'res.receipt_not_found': ['No booking fee receipt for this reservation.', 'การจองนี้ไม่มีใบเสร็จค่าจอง'],
  'movein.from_reservation': ['From the reservation of {name}. Check the details and complete the form.', 'จากการจองของ {name} ตรวจข้อมูลแล้วกรอกให้ครบ'],
  'movein.fee_credit': ['Booking fee {amount} already paid counts toward the deposit. Still to collect: {due}.', 'ค่าจอง {amount} ที่ชำระแล้วนับเป็นส่วนหนึ่งของเงินประกัน เก็บเพิ่มอีก {due}'],
  'contract.fee_credit': ['incl. booking fee {amount}', 'รวมค่าจอง {amount}'],
  'rooms.badge_booked': ['Booked from {date}', 'มีผู้จอง เข้า {date}'],
  'rooms.badge_pending': ['Booking request', 'มีคำขอจอง'],
  'rooms.badge_repairs': ['{n} open repair(s)', 'งานซ่อมค้าง {n}'],
  'err.room_already_reserved': ['This room already has an active reservation.', 'ห้องนี้มีการจองที่ยังไม่ปิดอยู่แล้ว'],
  'err.room_in_maintenance': ['This room is blocked for maintenance. Close the repair ticket first.', 'ห้องนี้ปิดซ่อมบำรุงอยู่ ต้องปิดงานซ่อมก่อน'],
  'err.room_no_move_out': ['The current tenant has no move-out date. Set the contract end date first.', 'ผู้เช่าปัจจุบันยังไม่มีวันย้ายออก ต้องใส่วันสิ้นสุดสัญญาก่อน'],
  'err.move_in_before_move_out': ['The move-in date is before the current tenant moves out.', 'วันย้ายเข้าอยู่ก่อนวันที่ผู้เช่าปัจจุบันย้ายออก'],
  'err.reservation_closed': ['This reservation is already closed.', 'การจองนี้ปิดไปแล้ว'],
  'err.reservation_not_active': ['This reservation is no longer active.', 'การจองนี้ไม่ได้อยู่ในสถานะที่ใช้ได้แล้ว'],
  'err.reservation_other_room': ['This reservation is for another room.', 'การจองนี้เป็นของห้องอื่น'],
  'err.room_reserved_for_other': ['This room is reserved for someone else. Use "Convert to move-in" on that reservation, or cancel it first.', 'ห้องนี้มีผู้จองอื่นอยู่ ใช้ "ย้ายเข้าจากการจอง" ที่การจองนั้น หรือยกเลิกการจองก่อน'],
  'err.bad_status_change': ['That status change is not allowed.', 'เปลี่ยนสถานะแบบนี้ไม่ได้'],

  // ---- maintenance (0012)
  'nav.maintenance': ['Maintenance', 'แจ้งซ่อม'],
  'status.open': ['Open', 'รอซ่อม'],
  'status.in_progress': ['In progress', 'กำลังซ่อม'],
  'status.done': ['Done', 'ซ่อมเสร็จ'],
  'mt.title': ['Maintenance', 'งานซ่อมบำรุง'],
  'mt.subtitle': ['Repairs and problems. Open tickets first, urgent on top.', 'รายการแจ้งซ่อม งานที่ยังไม่เสร็จอยู่ด้านบน งานด่วนอยู่บนสุด'],
  'mt.filter.open': ['Open', 'ยังไม่เสร็จ'],
  'mt.filter.closed': ['Closed', 'ปิดแล้ว'],
  'mt.filter.all': ['All', 'ทั้งหมด'],
  'mt.new': ['Report a problem', 'แจ้งซ่อม'],
  'mt.empty': ['No tickets in this list.', 'ไม่มีงานซ่อมในรายการนี้'],
  'mt.new_title': ['Report a problem', 'แจ้งซ่อม'],
  'mt.edit_title': ['Repair ticket – room {n}', 'งานซ่อม – ห้อง {n}'],
  'mt.f.title': ['What is wrong?', 'ปัญหาที่พบ'],
  'mt.f.description': ['Details', 'รายละเอียด'],
  'mt.f.category': ['Type', 'ประเภท'],
  'mt.f.priority': ['Priority', 'ความเร่งด่วน'],
  'mt.f.reported_by': ['Reported by', 'แจ้งโดย'],
  'mt.f.block': ['Block the room while this is open', 'ปิดห้องไว้จนกว่าจะซ่อมเสร็จ'],
  'mt.f.block_hint': ['A vacant room becomes "Maintenance": it cannot be reserved or moved into until the ticket is closed. Occupied rooms keep their status.', 'ห้องว่างจะเปลี่ยนเป็น "ซ่อมบำรุง" จองหรือย้ายเข้าไม่ได้จนกว่าจะปิดงานซ่อม ห้องที่มีผู้เช่าจะไม่เปลี่ยนสถานะ'],
  'mt.f.cost': ['Cost (฿)', 'ค่าใช้จ่าย (บาท)'],
  'mt.f.assigned': ['Assigned to', 'ผู้รับผิดชอบ'],
  'mt.f.photos': ['Photos', 'รูปภาพ'],
  'mt.add_photo': ['Add photo', 'เพิ่มรูป'],
  'mt.photo_after_save': ['Save the ticket first, then add photos.', 'บันทึกงานซ่อมก่อน แล้วจึงเพิ่มรูป'],
  'mt.photo_remove': ['Remove photo', 'ลบรูป'],
  'mt.cat.electric': ['Electric', 'ไฟฟ้า'],
  'mt.cat.water': ['Water', 'น้ำ / ประปา'],
  'mt.cat.ac': ['Air-con', 'แอร์'],
  'mt.cat.furniture': ['Furniture', 'เฟอร์นิเจอร์'],
  'mt.cat.other': ['Other', 'อื่นๆ'],
  'mt.prio.low': ['Low', 'ไม่เร่งด่วน'],
  'mt.prio.normal': ['Normal', 'ปกติ'],
  'mt.prio.urgent': ['Urgent', 'ด่วน'],
  'mt.by.staff': ['Staff', 'เจ้าหน้าที่'],
  'mt.by.tenant': ['Tenant', 'ผู้เช่า'],
  'mt.by.line': ['LINE chat', 'แชท LINE'],
  'mt.start': ['Start work', 'เริ่มซ่อม'],
  'mt.finish': ['Mark done', 'ซ่อมเสร็จ'],
  'mt.cancel': ['Cancel ticket', 'ยกเลิกงานซ่อม'],
  'mt.reopen': ['Reopen', 'เปิดงานอีกครั้ง'],
  'mt.saved': ['Ticket saved', 'บันทึกงานซ่อมแล้ว'],
  'mt.deleted': ['Ticket deleted', 'ลบงานซ่อมแล้ว'],
  'mt.delete_title': ['Delete this ticket?', 'ลบงานซ่อมนี้?'],
  'mt.delete_body': ['Only for mistakes. Finished work should be marked "Done" so the history stays.', 'ใช้เมื่อบันทึกผิดเท่านั้น งานที่ซ่อมแล้วให้กด "ซ่อมเสร็จ" เพื่อเก็บประวัติไว้'],
  'mt.opened': ['Reported {date}', 'แจ้งเมื่อ {date}'],
  'mt.closed': ['closed {date}', 'ปิดเมื่อ {date}'],
  'mt.blocking': ['Room blocked', 'ปิดห้องไว้'],
  'mt.cost_line': ['Cost {amount}', 'ค่าใช้จ่าย {amount}'],
  'mt.assigned_line': ['Assigned: {name}', 'ผู้รับผิดชอบ: {name}'],
  'mt.room_title': ['Maintenance history', 'ประวัติการซ่อม'],
  'mt.room_empty': ['No repairs recorded for this room.', 'ยังไม่มีประวัติการซ่อมของห้องนี้'],
  'err.ticket_room_fixed': ['A ticket cannot be moved to another room. Make a new ticket.', 'ย้ายงานซ่อมไปห้องอื่นไม่ได้ ให้สร้างงานใหม่'],

  // ---- dashboard extras
  'dash.open_tickets': ['Open repairs', 'งานซ่อมค้าง'],
  'dash.open_tickets_foot': ['{u} urgent', 'ด่วน {u} งาน'],
  'dash.reservations': ['Reservations', 'การจอง'],
  'dash.reservations_foot': ['{p} to confirm · {c} confirmed', 'รอยืนยัน {p} · ยืนยันแล้ว {c}'],

  // ---- LINE chats: "Wants to talk" (0013)
  'chat.title': ['Wants to talk', 'ต้องการคุยกับเจ้าหน้าที่'],
  'chat.hint': [
    'They tapped "Contact staff" in the LINE chat. Answer them in LINE OA Manager → Chats. The bot stays quiet for them for 12 hours, or until they type "menu".',
    'ลูกค้ากด "ติดต่อเจ้าหน้าที่" ในแชท LINE ให้ตอบใน LINE OA Manager → แชท ระบบตอบกลับอัตโนมัติจะหยุดตอบคนนี้ 12 ชั่วโมง หรือจนกว่าเขาจะพิมพ์ "เมนู"',
  ],
  'chat.empty': ['Nobody is waiting.', 'ไม่มีผู้ที่รออยู่'],
  'chat.since': ['Asked {date} {time}', 'ขอเมื่อ {date} {time}'],
  'chat.bot_quiet': ['Bot quiet until {time}', 'บอทหยุดตอบถึง {time}'],
  'chat.guest': ['Not a tenant', 'ไม่ใช่ผู้เช่า'],
  'chat.done': ['Done', 'ตอบแล้ว'],
  'chat.done_bot': ['Done, let the bot answer again', 'ตอบแล้ว ให้บอทตอบต่อ'],
  'chat.done_ok': ['Marked as answered', 'บันทึกว่าตอบแล้ว'],

  // ---- settings: LINE info (0013)
  'li.title': ['LINE info (what the bot answers)', 'ข้อมูลสำหรับ LINE (คำตอบของบอท)'],
  'li.hint': [
    'Shown when someone asks in the LINE chat. Write each text in Thai and in English. Empty = the bot says the information is not available yet. "Available rooms" is counted live from the rooms.',
    'บอทใช้ตอบเมื่อมีคนถามในแชท LINE กรอกทั้งภาษาไทยและภาษาอังกฤษ ถ้าเว้นว่าง บอทจะตอบว่ายังไม่มีข้อมูล ส่วน "ห้องว่างตอนนี้" ระบบนับจากสถานะห้องจริง',
  ],
  'li.key.room_types': ['Room types & prices', 'ประเภทห้องและราคา'],
  'li.key.facilities': ['Facilities', 'สิ่งอำนวยความสะดวก'],
  'li.key.location': ['Location / address', 'ที่ตั้ง / ที่อยู่'],
  'li.key.house_rules': ['House rules', 'กฎของหอพัก'],
  'li.key.deposit_terms': ['Deposit & contract terms', 'เงินประกันและเงื่อนไขสัญญา'],
  'li.location_hint': ['The first line is also used as the address on the map pin.', 'บรรทัดแรกจะใช้เป็นที่อยู่บนหมุดแผนที่ด้วย'],
  'li.th': ['Thai', 'ภาษาไทย'],
  'li.en': ['English', 'ภาษาอังกฤษ'],
  'li.office_phone': ['Office phone (sent with "Contact staff")', 'เบอร์โทรสำนักงาน (ส่งให้เมื่อกด "ติดต่อเจ้าหน้าที่")'],
  'li.office_hours_note': ['Office hours are set above, in the payment details.', 'เวลาทำการตั้งไว้ด้านบน ในส่วนข้อมูลการชำระเงิน'],
  'li.lat': ['Map latitude', 'ละติจูด (แผนที่)'],
  'li.lng': ['Map longitude', 'ลองจิจูด (แผนที่)'],
  'li.pin_hint': ['In Google Maps, long-press the dorm and copy the two numbers, e.g. 13.7563, 100.5018. Leave both empty for no map pin.', 'ใน Google Maps กดค้างที่หอพัก แล้วคัดลอกตัวเลขสองค่า เช่น 13.7563, 100.5018 เว้นว่างทั้งสองช่องถ้าไม่ต้องการหมุด'],
  'li.save': ['Save LINE info', 'บันทึกข้อมูล LINE'],
} as const satisfies Record<string, readonly [string, string]>;

export type TKey = keyof typeof D;
export type TFn = (key: TKey, vars?: Record<string, string | number>) => string;

const STORAGE_KEY = 'dorm.lang';

function readLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'en' || v === 'th') return v;
  } catch { /* storage blocked: fall back to Thai */ }
  return 'th';
}

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFn;
  money: (n: number | string | null | undefined) => string;
  date: (iso: string | null | undefined) => string;
  month: (m: string | null | undefined) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  }, []);

  const value = useMemo<I18n>(() => {
    const i = lang === 'th' ? 1 : 0;
    const t: TFn = (key, vars) => {
      let s: string = D[key][i];
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
      return s;
    };
    return {
      lang, setLang, t,
      money,
      date: (iso) => dateLabel(iso, lang),
      month: (m) => monthLabel(m, lang),
    };
  }, [lang, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n must be used inside <I18nProvider>');
  return v;
}

/** Turn a Supabase/Postgres error into a sentence a worker can act on. */
export function friendlyError(e: unknown, t: TFn): string {
  const err = e as { message?: string; code?: string; details?: string } | null;
  const m = String(err?.message ?? e ?? '');
  const code = err?.code ?? '';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return t('err.network');
  if (m.includes('ROOM_HAS_ACTIVE_CONTRACT') || m.includes('contracts_one_active_per_room')) return t('err.room_busy');
  if (m.includes('CONTRACT_NOT_ACTIVE')) return t('err.contract_not_active');
  if (m.includes('PAYMENT_EXCEEDS_BALANCE')) return t('err.overpay');
  if (m.includes('PRICE_ADMIN_ONLY')) return t('price.admin_only');
  if (m.includes('REQUEST_NOT_PENDING')) return t('err.request_not_pending');
  if (m.includes('ROOM_HAS_NO_TENANT')) return t('err.room_has_no_tenant');
  if (m.includes('SLIP_NOT_PENDING')) return t('err.slip_not_pending');
  if (m.includes('SLIP_HAS_NO_BILL')) return t('err.slip_has_no_bill');
  if (m.includes('LINE_NOT_CONFIGURED')) return t('err.line_not_configured');
  if (m.includes('tenants_line_user_id_key')) return t('err.line_taken');
  if (m.includes('ROOM_ALREADY_RESERVED') || m.includes('reservations_one_active_per_room')) return t('err.room_already_reserved');
  if (m.includes('ROOM_IN_MAINTENANCE')) return t('err.room_in_maintenance');
  if (m.includes('ROOM_NO_MOVE_OUT_DATE')) return t('err.room_no_move_out');
  if (m.includes('MOVE_IN_BEFORE_MOVE_OUT')) return t('err.move_in_before_move_out');
  if (m.includes('RESERVATION_CLOSED')) return t('err.reservation_closed');
  if (m.includes('RESERVATION_NOT_ACTIVE')) return t('err.reservation_not_active');
  if (m.includes('RESERVATION_OTHER_ROOM')) return t('err.reservation_other_room');
  if (m.includes('ROOM_RESERVED_FOR_OTHER')) return t('err.room_reserved_for_other');
  if (m.includes('BAD_RESERVATION_STATUS')) return t('err.bad_status_change');
  if (m.includes('TICKET_ROOM_FIXED')) return t('err.ticket_room_fixed');
  if (code === '23503' && /payments/.test(m + (err?.details ?? ''))) return t('err.has_payments');
  if (code === '42501' || /permission denied|row-level security|NOT_ALLOWED/i.test(m)) return t('err.permission');
  if (code === '23505') return t('err.duplicate');
  if (code === '23514' || code === '22P02' || code === '22007' || code === '22008') return t('err.check');
  return t('err.prefix') + m;
}
