export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_WEIGHT: Readonly<Record<LogLevel, number>> = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
});

/**
 * 极简分级日志。
 * 不引第三方日志库：单文件产物对体积敏感，且我们只需要按级别过滤 + 统一前缀。
 * 实例由 99-boot 创建，不做全局单例，方便测试时替换输出。
 */
export class Logger {
  private level: LogLevel;
  private readonly scope: string;

  constructor(level: LogLevel = 'info', scope = 'app') {
    this.level = level;
    this.scope = scope;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private enabled(level: Exclude<LogLevel, 'silent'>): boolean {
    return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[this.level];
  }

  private write(
    level: Exclude<LogLevel, 'silent'>,
    method: 'debug' | 'info' | 'warn' | 'error',
    args: readonly unknown[],
  ): void {
    if (!this.enabled(level)) {
      return;
    }
    console[method](`[${this.scope}]`, ...args);
  }

  debug(...args: readonly unknown[]): void {
    this.write('debug', 'debug', args);
  }

  info(...args: readonly unknown[]): void {
    this.write('info', 'info', args);
  }

  warn(...args: readonly unknown[]): void {
    this.write('warn', 'warn', args);
  }

  error(...args: readonly unknown[]): void {
    this.write('error', 'error', args);
  }
}
