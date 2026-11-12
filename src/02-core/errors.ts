/** 可预期且必须上屏告知用户的致命错误。phase 用于快速定位启动阶段。 */
export class FatalError extends Error {
  readonly phase: string;

  constructor(message: string, phase: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'FatalError';
    this.phase = phase;
  }
}

/** 把任意 throw 值规范化为 Error，避免 catch 里出现字符串/对象导致的二次异常。 */
export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(typeof value === 'string' ? value : JSON.stringify(value));
}
