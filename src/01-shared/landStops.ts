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
  // 转折点靠步道内侧，避开从入口直走时遇到的亭柱。
  { id: 'west-turn', name: '西廊南口', point: [-60, 85] },
  { id: 'grove-walk', name: '宝林西廊', point: LAND_JOURNEY.entries[4] },
] as const;

export const LAND_TOURS = [
  {
    id: 'axis-tour',
    name: '中轴漫步',
    stops: [LAND_STOPS[0], LAND_STOPS[1], LAND_STOPS[2], LAND_STOPS[3]],
  },
  { id: 'grove-tour', name: '西侧宝林', stops: [LAND_STOPS[0], LAND_STOPS[4], LAND_STOPS[5]] },
] as const;
