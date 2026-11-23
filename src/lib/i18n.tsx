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
  'f.end_date_hint': ['Leave empty if open-ended', 'เว้นว่างได้ถ้าไม่มีกำหนด'],
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
  'movein.maintenance_warn': ['This room is marked "Maintenance". Check it is ready before checking someone in.', 'ห้องนี้อยู่ในสถานะ "ซ่อมบำรุง" ตรวจสอบให้แน่ใจว่าห้องพร้อมก่อนให้ย้ายเข้า'],

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
  if (code === '23503' && /payments/.test(m + (err?.details ?? ''))) return t('err.has_payments');
  if (code === '42501' || /permission denied|row-level security|NOT_ALLOWED/i.test(m)) return t('err.permission');
  if (code === '23505') return t('err.duplicate');
  if (code === '23514' || code === '22P02' || code === '22007' || code === '22008') return t('err.check');
  return t('err.prefix') + m;
}
