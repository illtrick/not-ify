'use strict';

// Suite — youtube service does NOT route through VPN proxy
// YouTube blocks VPN IPs, so yt-dlp must never include --proxy args

function makeProc(stdoutData) {
  const EventEmitter = require('events');
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn();
  setImmediate(() => {
    if (stdoutData) proc.stdout.emit('data', stdoutData);
    proc.emit('close', 0);
  });
  return proc;
}

const SEARCH_JSON = JSON.stringify({
  id: 'test123456a',
  title: 'Test',
  duration: 180,
  channel: 'Ch',
  thumbnail: null,
  webpage_url: 'https://youtube.com/watch?v=test123456a',
}) + '\n';

const STREAM_URL = 'https://stream.example.com/audio.mp4\n';

describe('youtube service — no VPN proxy (YouTube blocks VPN IPs)', () => {
  test('searchYouTube does NOT pass --proxy even when VPN_PROXY is set', async () => {
    process.env.VPN_PROXY = 'http://test-proxy:8888';
    let capturedArgs;

    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn((cmd, args) => {
          capturedArgs = args;
          return makeProc(SEARCH_JSON);
        }),
      }));
      const yt = require('../../src/services/youtube');
      await yt.searchYouTube('test query', 5);
    });

    expect(capturedArgs).not.toContain('--proxy');
    delete process.env.VPN_PROXY;
  });

  test('searchSoundCloud does NOT pass --proxy even when VPN_PROXY is set', async () => {
    process.env.VPN_PROXY = 'http://test-proxy:8888';
    let capturedArgs;

    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn((cmd, args) => {
          capturedArgs = args;
          return makeProc(SEARCH_JSON);
        }),
      }));
      const yt = require('../../src/services/youtube');
      await yt.searchSoundCloud('test query', 5);
    });

    expect(capturedArgs).not.toContain('--proxy');
    delete process.env.VPN_PROXY;
  });

  test('getStreamUrl does NOT pass --proxy even when VPN_PROXY is set', async () => {
    process.env.VPN_PROXY = 'http://test-proxy:8888';
    let capturedArgs;

    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn((cmd, args) => {
          capturedArgs = args;
          return makeProc(STREAM_URL);
        }),
      }));
      const yt = require('../../src/services/youtube');
      await yt.getStreamUrl('dQw4w9WgXcQ');
    });

    expect(capturedArgs).not.toContain('--proxy');
    delete process.env.VPN_PROXY;
  });
});
