'use strict';

const mockDb = {
  getGlobalSetting: jest.fn(),
  setGlobalSetting: jest.fn(),
};
jest.mock('../../src/services/db', () => mockDb);
jest.mock('fs', () => ({ readFileSync: jest.fn().mockImplementation(() => { throw new Error('no file'); }) }));

let rd;
beforeEach(() => {
  jest.resetModules();
  mockDb.getGlobalSetting.mockReset();
  mockDb.setGlobalSetting.mockReset();
  rd = require('../../src/services/realdebrid');
});

test('setToken persists token to database', () => {
  rd.setToken('new-token-abc');
  expect(mockDb.setGlobalSetting).toHaveBeenCalledWith('realDebridToken', 'new-token-abc');
});

