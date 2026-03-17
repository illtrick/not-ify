/**
 * Configurable API client for Not-ify.
 *
 * Web (Docker-served): uses relative URLs — baseUrl = ''
 * Tauri desktop app: uses absolute server URL — baseUrl = 'http://192.168.1.50:3000'
 */

let _baseUrl = '';

function configure({ baseUrl }) {
  _baseUrl = (baseUrl || '').replace(/\/$/, '');
}

function getBaseUrl() {
  return _baseUrl;
}

async function request(path, options = {}) {
  const url = `${_baseUrl}${path}`;
  const headers = { ...options.headers };

  // Future: inject JWT auth header here
  // const token = getToken();
  // if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const error = new Error(`API ${response.status}: ${response.statusText}`);
    error.status = response.status;
    try {
      error.body = await response.json();
    } catch {}
    throw error;
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json();
  }
  return response;
}

function get(path, options = {}) {
  return request(path, { ...options, method: 'GET' });
}

function post(path, body, options = {}) {
  return request(path, {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: JSON.stringify(body),
  });
}

function del(path, options = {}) {
  return request(path, { ...options, method: 'DELETE' });
}

function put(path, body, options = {}) {
  return request(path, {
    ...options,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: JSON.stringify(body),
  });
}

module.exports = { configure, getBaseUrl, request, get, post, del, put };
