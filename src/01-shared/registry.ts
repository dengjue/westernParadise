/**
 * 通用只读注册表，供后续「场景 / 季相 / 天气 / 天空变体」等扩展点复用。
 * 参考件用 registerGameMap() + selectGameMap() 在 boot 第一句锁定配置；
 * 这里保留同一机制但做成泛型，避免每个扩展点各写一套、彼此行为不一致。
 */
export interface RegistryEntry<T> {
  readonly id: string;
  readonly entry: T;
}

export interface Registry<T> {
  register(id: string, entry: T): void;
  get(id: string): T | undefined;
  has(id: string): boolean;
  list(): readonly RegistryEntry<T>[];
  readonly size: number;
  /** 冻结后不可再注册：boot 完成装配后调用，防止运行中偷偷换场景。 */
  freeze(): void;
}

export function createRegistry<T>(): Registry<T> {
  const entries = new Map<string, T>();
  let frozen = false;

  return {
    register(id, entry) {
      if (frozen) {
        throw new Error(`注册表已冻结，不能再注册：${id}`);
      }
      if (entries.has(id)) {
        throw new Error(`重复注册：${id}`);
      }
      entries.set(id, entry);
    },
    get(id) {
      return entries.get(id);
    },
    has(id) {
      return entries.has(id);
    },
    list() {
      return Array.from(entries, ([id, entry]) => ({ id, entry }) as const);
    },
    get size() {
      return entries.size;
    },
    freeze() {
      frozen = true;
    },
  };
}
