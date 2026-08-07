export type OwnedMapMeasurement = {
  identity: string;
  height: number;
};

export function getEffectiveSelectedSeats(
  selectedSeats: readonly number[],
  selectedSeatsIdentity: string | null,
  activeZoneIdentity: string,
  cartSeatIds: ReadonlySet<number>,
) {
  if (selectedSeatsIdentity !== activeZoneIdentity) return [];
  return selectedSeats.filter((seatId) => !cartSeatIds.has(seatId));
}

export function getOwnedMapHeight(
  measurement: OwnedMapMeasurement | null,
  activeIdentity: string,
  fallbackHeight: number,
) {
  return measurement?.identity === activeIdentity ? measurement.height : fallbackHeight;
}
