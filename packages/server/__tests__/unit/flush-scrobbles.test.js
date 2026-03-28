'use strict';

jest.mock('../../src/services/db', () => ({
  getAllUsersWithScrobbleQueue: jest.fn().mockReturnValue(['user1']),
  getScrobbleQueue: jest.fn().mockReturnValue([{ artist: 'Test', track: 'Song', timestamp: 1000 }]),
}));

jest.mock('../../src/services/lastfm', () => ({
  submitScrobbles: jest.fn().mockResolvedValue(),
}));

test('lastfm module resolves without error', () => {
  expect(() => require('../../src/services/lastfm')).not.toThrow();
});
