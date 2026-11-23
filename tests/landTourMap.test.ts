import { expect, it } from 'vitest';
import { LAND_TOURS } from '@/01-shared';
import { tourProjection } from '@/08-ui/LandTourMap';

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
