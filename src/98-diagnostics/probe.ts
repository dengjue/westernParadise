import { toError } from '@/02-core';

/**
 * 诊断钩子。
 * 参考件把 window.__G 与 window.__fatal 当作工程兜底，这里保留设计但收紧：
 * __G 只在开发模式或 ?debug=1 时挂载，生产单文件不暴露内部对象。
 */

type DebugWindow = Window & {
  __G?: Readonly<Record<string, unknown>>;
  __fatal?: string;
};

export function installDebugProbe(enabled: boolean, info: Readonly<Record<string, unknown>>): void {
  if (!enabled) {
    return;
  }
  const target = window as DebugWindow;
  Object.defineProperty(target, '__G', {
    value: Object.freeze({ ...info }),
    configurable: true,
    writable: false,
  });
}

/** 把致命错误写成可查询的全局标记，便于自动化验收读取。 */
export function markFatal(detail: string): void {
  (window as DebugWindow).__fatal = detail;
}

/** 捕获未处理的同步错误与 Promise 拒绝，返回注销函数。 */
export function installFatalTrap(onFatal: (phase: string, error: Error) => void): () => void {
  const onError = (event: ErrorEvent): void => {
    onFatal('window.error', toError(event.error ?? event.message));
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    onFatal('unhandledrejection', toError(event.reason));
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
