import { expect, it } from 'vitest';
import { readUiPreference, writeUiPreference } from '@/03-platform';

it('区分未选择与主动收起，两项偏好互不覆盖', () => {
  const values = new Map<string, string>();
  const store = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
  expect(readUiPreference(store, 'navigationExpanded')).toBeNull();
  writeUiPreference(store, 'rightMove', true);
  writeUiPreference(store, 'navigationExpanded', false);
  expect(readUiPreference(store, 'rightMove')).toBe(true);
  expect(readUiPreference(store, 'navigationExpanded')).toBe(false);
  for (const key of values.keys()) values.set(key, 'broken');
  expect(readUiPreference(store, 'rightMove')).toBeNull();
});
