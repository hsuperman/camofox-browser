import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { loadPluginTools } from '../helpers/openclawPluginHarness.js';

const originalFetch = globalThis.fetch;

describe('Netscape cookie file parser', () => {
  let cookiesDir;
  let originalApiKey;
  let originalCookiesDir;
  let importCookies;
  let fileNumber = 0;

  beforeAll(async () => {
    cookiesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'camofox-plugin-cookies-'));
    originalApiKey = process.env.CAMOFOX_API_KEY;
    originalCookiesDir = process.env.CAMOFOX_COOKIES_DIR;
    process.env.CAMOFOX_API_KEY = 'test-api-key';
    process.env.CAMOFOX_COOKIES_DIR = cookiesDir;
    importCookies = loadPluginTools().camofox_import_cookies;
  });

  beforeEach(() => {
    globalThis.fetch = jest.fn().mockResolvedValue(new Response(
      JSON.stringify({ ok: true }),
      { headers: { 'Content-Type': 'application/json' } }
    ));
  });

  afterAll(async () => {
    if (originalApiKey === undefined) delete process.env.CAMOFOX_API_KEY;
    else process.env.CAMOFOX_API_KEY = originalApiKey;
    if (originalCookiesDir === undefined) delete process.env.CAMOFOX_COOKIES_DIR;
    else process.env.CAMOFOX_COOKIES_DIR = originalCookiesDir;
    globalThis.fetch = originalFetch;
    await fs.rm(cookiesDir, { recursive: true, force: true });
  });

  async function parseThroughPlugin(text) {
    const cookiesPath = `cookies-${fileNumber++}.txt`;
    await fs.writeFile(path.join(cookiesDir, cookiesPath), text);
    await importCookies.execute('test-call', { cookiesPath });

    const [, request] = globalThis.fetch.mock.calls[0];
    return JSON.parse(request.body).cookies;
  }

  test('parses a basic 7-field line', async () => {
    const cookies = await parseThroughPlugin('.example.com\tTRUE\t/\tFALSE\t0\tsession_id\tabc123');
    expect(cookies).toEqual([{
      name: 'session_id', value: 'abc123', domain: '.example.com', path: '/',
      expires: 0, httpOnly: false, secure: false,
    }]);
  });

  test('parses secure cookie', async () => {
    const cookies = await parseThroughPlugin('.example.com\tTRUE\t/\tTRUE\t1700000000\ttoken\txyz');
    expect(cookies[0].secure).toBe(true);
    expect(cookies[0].expires).toBe(1700000000);
  });

  test('detects #HttpOnly_ prefix', async () => {
    const cookies = await parseThroughPlugin('#HttpOnly_.example.com\tTRUE\t/\tTRUE\t0\tsid\tval');
    expect(cookies).toHaveLength(1);
    expect(cookies[0].httpOnly).toBe(true);
    expect(cookies[0].domain).toBe('.example.com');
  });

  test('skips comment lines', async () => {
    const cookies = await parseThroughPlugin([
      '# Netscape HTTP Cookie File', '# This is a comment',
      '.example.com\tTRUE\t/\tFALSE\t0\tname\tvalue',
    ].join('\n'));
    expect(cookies).toHaveLength(1);
    expect(cookies[0].name).toBe('name');
  });

  test('skips empty lines', async () => {
    const cookies = await parseThroughPlugin([
      '', '.example.com\tTRUE\t/\tFALSE\t0\ta\tb', '', '',
      '.test.com\tFALSE\t/path\tTRUE\t0\tc\td', '',
    ].join('\n'));
    expect(cookies).toHaveLength(2);
  });

  test('skips lines with fewer than 7 tab-separated fields', async () => {
    const cookies = await parseThroughPlugin([
      '.example.com\tTRUE\t/\tFALSE\t0\tname', 'too\tfew\tfields',
      '.example.com\tTRUE\t/\tFALSE\t0\tgood\tvalue',
    ].join('\n'));
    expect(cookies).toHaveLength(1);
    expect(cookies[0].name).toBe('good');
  });

  test('handles cookie value containing tabs', async () => {
    const cookies = await parseThroughPlugin('.example.com\tTRUE\t/\tFALSE\t0\tname\tval\twith\ttabs');
    expect(cookies[0].value).toBe('val\twith\ttabs');
  });

  test('handles Windows line endings (\\r\\n)', async () => {
    const cookies = await parseThroughPlugin('.a.com\tTRUE\t/\tFALSE\t0\tx\t1\r\n.b.com\tTRUE\t/\tFALSE\t0\ty\t2\r\n');
    expect(cookies).toHaveLength(2);
    expect(cookies[0].name).toBe('x');
    expect(cookies[1].name).toBe('y');
  });

  test('handles UTF-8 BOM prefix', async () => {
    const cookies = await parseThroughPlugin('\uFEFF# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tFALSE\t0\tname\tvalue');
    expect(cookies).toHaveLength(1);
    expect(cookies[0].name).toBe('name');
  });

  test('handles BOM before #HttpOnly_ on first line', async () => {
    const cookies = await parseThroughPlugin('\uFEFF#HttpOnly_.example.com\tTRUE\t/\tTRUE\t0\tsid\tsecret');
    expect(cookies).toHaveLength(1);
    expect(cookies[0].httpOnly).toBe(true);
    expect(cookies[0].domain).toBe('.example.com');
  });

  test('serializes NaN expires as JSON null', async () => {
    const cookies = await parseThroughPlugin('.example.com\tTRUE\t/\tFALSE\tgarbage\tname\tvalue');
    expect(cookies).toHaveLength(1);
    expect(cookies[0].expires).toBeNull();
  });

  test('parses multiple cookies from a real-format file', async () => {
    const cookies = await parseThroughPlugin([
      '# Netscape HTTP Cookie File', '# https://curl.se/docs/http-cookies.html', '',
      '.linkedin.com\tTRUE\t/\tTRUE\t1700000000\tli_at\tAQEDAT...',
      '#HttpOnly_.linkedin.com\tTRUE\t/\tTRUE\t0\tJSESSIONID\tajax:123',
      '.linkedin.com\tTRUE\t/\tFALSE\t1700000000\tlang\tv=2&lang=en-us',
    ].join('\n'));
    expect(cookies).toHaveLength(3);
    expect(cookies[0]).toMatchObject({ name: 'li_at', secure: true, httpOnly: false });
    expect(cookies[1]).toMatchObject({ name: 'JSESSIONID', httpOnly: true, secure: true });
    expect(cookies[2]).toMatchObject({ name: 'lang', secure: false });
  });

  test('returns empty array for empty input', async () => {
    expect(await parseThroughPlugin('')).toEqual([]);
  });

  test('returns empty array for comments-only file', async () => {
    expect(await parseThroughPlugin('# comment\n# another comment\n')).toEqual([]);
  });

  test('skips lines where trailing tab is trimmed (empty value)', async () => {
    expect(await parseThroughPlugin('.example.com\tTRUE\t/\tFALSE\t0\tname\t')).toEqual([]);
  });

  test('parses empty value when followed by another line', async () => {
    const cookies = await parseThroughPlugin('.example.com\tTRUE\t/\tFALSE\t0\tempty_val\t\n.b.com\tTRUE\t/\tFALSE\t0\tother\tval');
    expect(cookies).toHaveLength(1);
    expect(cookies[0].name).toBe('other');
  });
});
