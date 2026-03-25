'use strict';

/**
 * VPN Provider data for gluetun integration.
 * Curated list of popular providers with region lists.
 */

const PROVIDERS = [
  { id: 'private internet access', label: 'Private Internet Access (PIA)', protocol: 'openvpn', regions: ['US East', 'US West', 'US Las Vegas', 'US California', 'US Florida', 'UK London', 'Netherlands', 'Germany Frankfurt', 'Japan', 'Australia Melbourne'] },
  { id: 'nordvpn', label: 'NordVPN', protocol: 'openvpn', regions: ['United States', 'United Kingdom', 'Netherlands', 'Germany', 'France', 'Japan', 'Australia', 'Canada', 'Switzerland', 'Sweden'] },
  { id: 'surfshark', label: 'Surfshark', protocol: 'openvpn', regions: ['us-nyc', 'us-lax', 'us-chi', 'uk-lon', 'nl-ams', 'de-fra', 'jp-tok', 'au-syd', 'ca-tor', 'fr-par'] },
  { id: 'mullvad', label: 'Mullvad', protocol: 'wireguard', regions: ['us-nyc', 'us-lax', 'us-chi', 'gb-lon', 'nl-ams', 'de-fra', 'jp-tyo', 'au-syd', 'ca-tor', 'se-sto'] },
  { id: 'protonvpn', label: 'ProtonVPN', protocol: 'openvpn', regions: ['US', 'UK', 'Netherlands', 'Germany', 'Japan', 'Australia', 'Canada', 'Switzerland', 'France', 'Sweden'] },
  { id: 'expressvpn', label: 'ExpressVPN', protocol: 'openvpn', regions: ['USA - New York', 'USA - Los Angeles', 'USA - Chicago', 'UK - London', 'Netherlands', 'Germany - Frankfurt', 'Japan', 'Australia - Sydney', 'Canada - Toronto', 'France - Paris'] },
  { id: 'ivpn', label: 'IVPN', protocol: 'wireguard', regions: ['us-nj', 'us-ca', 'us-tx', 'gb', 'nl', 'de', 'jp', 'au', 'ca', 'se'] },
  { id: 'windscribe', label: 'Windscribe', protocol: 'wireguard', regions: ['US East', 'US West', 'US Central', 'UK', 'Netherlands', 'Germany', 'Japan', 'Australia', 'Canada East', 'France'] },
  { id: 'cyberghost', label: 'CyberGhost', protocol: 'openvpn', regions: ['US', 'UK', 'Germany', 'Netherlands', 'France', 'Japan', 'Australia', 'Canada', 'Switzerland', 'Sweden'] },
  { id: 'torguard', label: 'TorGuard', protocol: 'openvpn', regions: ['US-NEWYORK', 'US-LOSANGELES', 'US-CHICAGO', 'UK-LONDON', 'NETHERLANDS', 'GERMANY', 'JAPAN', 'AUSTRALIA', 'CANADA', 'FRANCE'] },
];

function getProviders() {
  return PROVIDERS.map(p => ({ id: p.id, label: p.label, protocol: p.protocol }));
}

function getProviderRegions(providerId) {
  const provider = PROVIDERS.find(p => p.id === providerId);
  return provider ? provider.regions : [];
}

function getProviderById(providerId) {
  return PROVIDERS.find(p => p.id === providerId) || null;
}

/**
 * Get the gluetun env var mapping for a provider.
 * Most use OPENVPN_USER/OPENVPN_PASSWORD, but Mullvad and some others differ.
 */
function getGluetunEnvVars(provider, username, password, region) {
  const vars = {
    VPN_SERVICE_PROVIDER: provider,
    SERVER_REGIONS: region || '',
  };

  // Most providers use OpenVPN user/pass
  if (provider === 'mullvad') {
    // Mullvad uses account number as WIREGUARD_PRIVATE_KEY or OPENVPN_USER
    vars.OPENVPN_USER = username;
    vars.OPENVPN_PASSWORD = password || 'm'; // Mullvad doesn't use passwords for WireGuard
  } else {
    vars.OPENVPN_USER = username;
    vars.OPENVPN_PASSWORD = password;
  }

  return vars;
}

module.exports = { getProviders, getProviderRegions, getProviderById, getGluetunEnvVars, PROVIDERS };
