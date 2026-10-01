export interface ShiftSlot {
  label: string;
  startHour: number;
  endHour: number;
  crossesMidnight: boolean;
}

export const SHIFT_SLOTS: ShiftSlot[] = [
  { label: 'Matin', startHour: 6, endHour: 14, crossesMidnight: false },
  { label: 'Apres-midi', startHour: 14, endHour: 22, crossesMidnight: false },
  { label: 'Nuit', startHour: 22, endHour: 6, crossesMidnight: true },
];

export function buildSlotTimes(day: Date, slot: ShiftSlot): { start: Date; end: Date } {
  const start = new Date(day);
  start.setHours(slot.startHour, 0, 0, 0);

  const end = new Date(day);
  if (slot.crossesMidnight) {
    end.setDate(end.getDate() + 1);
  }
  end.setHours(slot.endHour, 0, 0, 0);

  return { start, end };
}