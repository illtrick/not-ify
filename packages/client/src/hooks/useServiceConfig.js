import { useState, useEffect, useCallback } from 'react';

/**
 * Generic hook for service config: load status, save config, test connection.
 * @param {object} opts
 * @param {Function} opts.getStatus  — async () => { configured, ...details }
 * @param {Function} opts.saveConfig — async (fields) => { saved }
 * @param {Function} opts.testConn   — async () => { status, ...result }
 * @param {boolean}  opts.enabled    — whether to load (false for non-admin)
 */
export function useServiceConfig({ getStatus, saveConfig, testConn, enabled = true }) {
  const [status, setStatus] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const data = await getStatus();
      setStatus(data);
    } catch (err) {
      setError(err.message);
    }
  }, [getStatus, enabled]);

  useEffect(() => { load(); }, [load]);

  async function save(fields) {
    if (saving) return false;
    setSaving(true);
    setError(null);
    try {
      await saveConfig(fields);
      await load();
      setSaving(false);
      return true;
    } catch (err) {
      setError(err.message);
      setSaving(false);
      return false;
    }
  }

  async function test() {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const result = await testConn();
      setTestResult(result);
    } catch (err) {
      setTestResult({ status: 'error', error: err.message });
    } finally {
      setTesting(false);
    }
  }

  return { status, testResult, testing, saving, error, save, test, reload: load };
}
