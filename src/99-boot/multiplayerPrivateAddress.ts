import { isIPv4 } from 'node:net';
import { networkInterfaces } from 'node:os';

/** 只允许绑定实际配置在本机网卡上的 RFC 1918 地址。 */
export function isLocalPrivateAddress(ip: string): boolean {
  return (
    isIPv4(ip) &&
    /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(ip) &&
    Object.values(networkInterfaces())
      .flat()
      .some((info) => info?.family === 'IPv4' && !info.internal && info.address === ip)
  );
}
