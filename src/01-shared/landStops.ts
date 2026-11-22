import { LAND_JOURNEY } from './landJourney';

/** 到达后留出离开半径，避免沿边缘走动时状态来回跳。 */
export function landStopArrival(
  distance: number,
  flying: boolean,
  near: boolean,
): 'away' | 'overhead' | 'arrived' {
  if (distance > (near ? 5 : 3)) return 'away';
  return flying ? 'overhead' : 'arrived';
}

/** 目的地使用游历入口中的可走点，而不是建筑或水面的几何中心。 */
export const LAND_STOPS = [
  { id: 'entrance', name: '南侧入口', point: LAND_JOURNEY.entries[0] },
  { id: 'south-axis', name: '南段中轴', point: LAND_JOURNEY.entries[1] },
  { id: 'central-axis', name: '中轴庭院', point: LAND_JOURNEY.entries[2] },
  { id: 'hall-front', name: '主殿前场', point: LAND_JOURNEY.entries[3] },
] as const;
