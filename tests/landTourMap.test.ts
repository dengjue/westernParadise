import { expect, it } from 'vitest';
import { LAND_STOPS, LAND_TOURS } from '@/01-shared';
import { tourProjection } from '@/08-ui/LandTourMap';

it('单点地图居中并保留至少六十米的南北视野，比例尺适用于全部目标', () => {
  for (const stop of LAND_STOPS) {
    const project = tourProjection([stop]);
    const [x, z] = stop.point;
    expect(project(x, z)).toEqual({ x: 90, y: 54 });
    expect(project(x, z - 30).y).toBeGreaterThanOrEqual(0);
    expect(project(x, z + 30).y).toBeLessThanOrEqual(108);
  }
  for (const stops of [...LAND_TOURS.map((t) => t.stops), ...LAND_STOPS.map((s) => [s])]) {
    const project = tourProjection(stops);
    const length = project(20, 0).x - project(0, 0).x;
    expect(length).toBeGreaterThan(0);
    expect(length).toBeLessThan(176);
  }
});

it('三条游线均在图内，正北向上、正东向右且两轴等比', () => {
  for (const tour of LAND_TOURS) {
    const project = tourProjection(tour.stops);
    for (const stop of tour.stops) {
      const { x, y } = project(stop.point[0], stop.point[1]);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(180);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(108);
    }
    const center = project(0, 0),
      east = project(1, 0),
      north = project(0, -1);
    expect(east.x - center.x).toBeGreaterThan(0);
    expect(east.x - center.x).toBeCloseTo(center.y - north.y, 8);
  }
});
