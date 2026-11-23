import { useState } from 'react';
import { setRoomPrices } from '../lib/api';
import { useFeedback } from '../lib/feedback';
import { parseNum } from '../lib/format';
import { friendlyError, useI18n } from '../lib/i18n';
import { NumInput } from './common';
import { Btn } from './ui';

export interface PricedRoom { id: string; number: string; default_rent: number; water_per_person: number; occupants: number }
export interface WaterPrices { water_price_old: number; water_price_new: number }

/** Water price choice (old / new customer), people and rent for one room.
 *  Saved to the room, so the next month's bill starts from the same values. */
export function RoomPricesEditor({ room, prices, onSaved, compact = false }: {
  room: PricedRoom; prices: WaterPrices; onSaved: () => void; compact?: boolean;
}) {
  const { t, money } = useI18n();
  const { toast } = useFeedback();
  const [water, setWater] = useState(String(Number(room.water_per_person)));
  const [people, setPeople] = useState(String(room.occupants));
  const [rent, setRent] = useState(String(Number(room.default_rent)));
  const [busy, setBusy] = useState(false);

  const oldP = Number(prices.water_price_old), newP = Number(prices.water_price_new);
  const current = Number(room.water_per_person);
  const options = [
    { value: oldP, label: t('price.water_old', { p: money(oldP) }) },
    { value: newP, label: t('price.water_new', { p: money(newP) }) },
    ...(current !== oldP && current !== newP ? [{ value: current, label: t('price.water_other', { p: money(current) }) }] : []),
  ];

  const w = parseNum(water), p = parseNum(people), r = parseNum(rent);
  const valid = w !== null && w >= 0 && p !== null && Number.isInteger(p) && p >= 0 && p <= 20 && r !== null && r >= 0;
  const changed = w !== current || p !== room.occupants || r !== Number(room.default_rent);

  const save = async () => {
    if (!valid) { toast(t('err.check'), 'error'); return; }
    setBusy(true);
    try {
      await setRoomPrices(room.id, r!, w!, p!);
      toast(t('price.saved', { n: room.number }));
      onSaved();
    } catch (e) { toast(friendlyError(e, t), 'error'); } finally { setBusy(false); }
  };

  return (
    <div className={`grid gap-2 items-end ${compact ? 'grid-cols-[1.4fr_0.6fr_1fr_auto] max-[640px]:grid-cols-2' : 'grid-cols-3 max-[640px]:grid-cols-1'}`}>
      <label className="flex flex-col gap-1 text-[12px] text-muted font-semibold">
        {t('price.water')}
        <select value={water} onChange={(e) => setWater(e.target.value)}>
          {options.map((o) => <option key={o.value} value={String(o.value)}>{o.label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-muted font-semibold">
        {t('price.people')}
        <input type="number" inputMode="numeric" min={0} max={20} step={1} value={people} onChange={(e) => setPeople(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-muted font-semibold">
        {t('price.rent')}
        <NumInput value={rent} onChange={(e) => setRent(e.target.value)} />
      </label>
      <Btn small={compact} disabled={busy || !changed || !valid} onClick={() => void save()}
        className={compact ? 'justify-center max-[640px]:col-span-2 py-2.5' : 'justify-center col-span-full w-fit'}>
        {busy ? t('common.saving') : t('common.save')}
      </Btn>
    </div>
  );
}
