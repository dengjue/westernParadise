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
  // 取东廊近池一侧的可通行线，避开中线亭柱。
  { id: 'east-turn', name: '东廊南口', point: [61.5, 85] },
  { id: 'lotus-walk', name: '莲池东廊', point: [61.5, 24] },
] as const;

/** 只在地面进入本站范围时出现；与站点 ID 一一对应。 */
export const LAND_STOP_NOTES: Readonly<Record<(typeof LAND_STOPS)[number]['id'], string>> = {
  entrance: '朝北看，让步道的两侧边线在远处的主殿前汇合。',
  'south-axis': '在这里停一步，比较近处铺装与远处屋檐的尺度。',
  'central-axis': '缓慢转向两侧，看看树冠与水面如何改变庭院的开阔感。',
  'hall-front': '抬头沿屋檐看过去，再低头比较台基与庭院的高差。',
  'west-turn': '转向北面，沿西廊寻找下一段树荫。',
  'grove-walk': '面向庭院，观察近处枝叶和远处建筑叠在一起的轮廓。',
  'east-turn': '向北沿东廊前行，把水面留在左手边。',
  'lotus-walk': '向西望向莲池，稍稍转动视角，比较水面反光与岸边的颜色。',
};

export const LAND_TOURS = [
  {
    id: 'axis-tour',
    name: '中轴漫步',
    stops: [LAND_STOPS[0], LAND_STOPS[1], LAND_STOPS[2], LAND_STOPS[3]],
  },
  { id: 'grove-tour', name: '西侧宝林', stops: [LAND_STOPS[0], LAND_STOPS[4], LAND_STOPS[5]] },
  { id: 'lotus-tour', name: '东侧莲池', stops: [LAND_STOPS[0], LAND_STOPS[6], LAND_STOPS[7]] },
] as const;
