/**
 * Minimal User-Agent parser for login notifications. Dependency-free on
 * purpose: we only need coarse browser / OS / device labels for a security
 * email, not fingerprinting-grade accuracy. Unknown → "Unknown".
 */

export interface DeviceInfo {
  browser: string;
  os: string;
  device: string;
}

export function parseUserAgent(ua: unknown): DeviceInfo {
  if (typeof ua !== 'string' || !ua) return { browser: 'Unknown', os: 'Unknown', device: 'Unknown' };
  const s = ua.slice(0, 512);

  let browser = 'Unknown';
  const chrome = /Chrome\/(\d+)/.exec(s);
  const edge = /Edg(?:e|A|iOS)?\/(\d+)/.exec(s);
  const firefox = /Firefox\/(\d+)/.exec(s);
  const safariVer = /Version\/(\d+)[\d.]*.*Safari\//.exec(s);
  const opera = /OPR\/(\d+)/.exec(s);
  if (edge) browser = `Edge ${edge[1]}`;
  else if (opera) browser = `Opera ${opera[1]}`;
  else if (chrome && !/Chromium/.test(s)) browser = `Chrome ${chrome[1]}`;
  else if (/Chromium\/(\d+)/.test(s)) browser = `Chromium ${/Chromium\/(\d+)/.exec(s)?.[1]}`;
  else if (firefox) browser = `Firefox ${firefox[1]}`;
  else if (safariVer) browser = `Safari ${safariVer[1]}`;
  else if (/Safari\//.test(s)) browser = 'Safari';

  let os = 'Unknown';
  const win = /Windows NT ([\d.]+)/.exec(s);
  const mac = /Mac OS X ([\d_]+)/.exec(s);
  const android = /Android ([\d.]+)/.exec(s);
  const ios = /OS ([\d_]+) like Mac OS X/.exec(s);
  if (/iPhone|iPad|iPod/.test(s)) os = ios ? `iOS ${ios[1].replace(/_/g, '.')}` : 'iOS';
  else if (android) os = `Android ${android[1]}`;
  else if (win) os = win[1].startsWith('10') ? 'Windows 10/11' : `Windows ${win[1]}`;
  else if (mac) os = `macOS ${mac[1].replace(/_/g, '.')}`;
  else if (/Linux/.test(s)) os = 'Linux';

  let device = 'Desktop';
  if (/iPad|Tablet/.test(s)) device = 'Tablet';
  else if (/Mobile|Android|iPhone|iPod/.test(s)) device = 'Mobile';

  return { browser, os, device };
}
