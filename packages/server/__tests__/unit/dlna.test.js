'use strict';

// Mock node-ssdp and upnp-client-ts so tests don't touch the network
jest.mock('node-ssdp', () => ({
  Client: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    search: jest.fn(),
    stop: jest.fn(),
  })),
}));

jest.mock('upnp-client-ts', () => ({
  UpnpMediaRendererClient: jest.fn(),
}));

const dlna = require('../../src/services/dlna');

describe('dlna.buildDidlLite', () => {
  it('includes title, artist, album in output', () => {
    const xml = dlna.buildDidlLite({
      title: 'High & Dry',
      artist: 'Radiohead',
      album: 'The Bends',
      albumArtUrl: 'http://server/cover.jpg',
      streamUrl: 'http://server/api/stream/abc?sig=xyz&exp=9999',
      mimeType: 'audio/flac',
    });
    expect(xml).toContain('<dc:title>High &amp; Dry</dc:title>');
    expect(xml).toContain('<upnp:artist>Radiohead</upnp:artist>');
    expect(xml).toContain('<upnp:album>The Bends</upnp:album>');
  });

  it('includes stream URL and mimeType in res element', () => {
    const xml = dlna.buildDidlLite({
      title: 'Test',
      artist: 'Artist',
      album: 'Album',
      streamUrl: 'http://server/api/stream/abc',
      mimeType: 'audio/mpeg',
    });
    expect(xml).toContain('protocolInfo="http-get:*:audio/mpeg:*"');
    expect(xml).toContain('http://server/api/stream/abc');
  });

  it('escapes special XML characters', () => {
    const xml = dlna.buildDidlLite({
      title: '<"Test">',
      artist: 'A & B',
      album: 'Album',
      streamUrl: 'http://server/stream',
      mimeType: 'audio/flac',
    });
    expect(xml).not.toContain('<"Test">');
    expect(xml).toContain('&lt;&quot;Test&quot;&gt;');
    expect(xml).toContain('A &amp; B');
  });

  it('handles missing optional fields gracefully', () => {
    expect(() => dlna.buildDidlLite({
      title: 'T',
      artist: 'A',
      album: 'L',
      streamUrl: 'http://server/stream',
      mimeType: 'audio/mpeg',
    })).not.toThrow();
  });
});

describe('dlna.getDevices', () => {
  it('returns an empty array when no devices discovered', () => {
    expect(dlna.getDevices()).toEqual([]);
  });
});
