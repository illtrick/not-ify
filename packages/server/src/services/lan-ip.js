'use strict';

const os = require('os');

// Virtual/container interfaces to skip when auto-detecting LAN IP
const VIRTUAL_PATTERNS = [/vEthernet/i, /WSL/i, /Hyper-V/i, /VirtualBox/i, /VMware/i, /docker/i, /br-/];

function getLanIp() {
  if (process.env.LAN_IP) return process.env.LAN_IP;
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    const isVirtual = VIRTUAL_PATTERNS.some(p => p.test(name));
    for (const iface of addrs) {
      if (iface.family === 'IPv4' && !iface.internal) {
        candidates.push({ address: iface.address, name, isVirtual });
      }
    }
  }
  // Prefer non-virtual interfaces
  const real = candidates.find(c => !c.isVirtual);
  return real ? real.address : (candidates[0]?.address || '127.0.0.1');
}

module.exports = { getLanIp };
