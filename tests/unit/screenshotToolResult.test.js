import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { loadPluginTools } from '../helpers/openclawPluginHarness.js';

const originalFetch = globalThis.fetch;

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64'
);

describe('camofox_screenshot tool result', () => {
  let screenshot;

  beforeAll(() => {
    screenshot = loadPluginTools().camofox_screenshot;
  });

  beforeEach(() => {
    globalThis.fetch = jest.fn().mockResolvedValue(new Response(TINY_PNG, {
      headers: { 'Content-Type': 'image/png' },
    }));
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  async function executeScreenshot(tabId = 'some-tab') {
    return screenshot.execute('test-call', { tabId });
  }

  test('returns image content block with base64 PNG', async () => {
    const result = await executeScreenshot();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(typeof result.content[0].data).toBe('string');
    expect(result.content[0].data.length).toBeGreaterThan(0);
  });

  test('base64 data decodes back to valid PNG', async () => {
    const result = await executeScreenshot();
    const decoded = Buffer.from(result.content[0].data, 'base64');
    expect(decoded.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  test('base64 data round-trips to the exact original bytes', async () => {
    const result = await executeScreenshot();
    expect(Buffer.from(result.content[0].data, 'base64')).toEqual(TINY_PNG);
  });

  test('does not contain a text content block', async () => {
    const result = await executeScreenshot();
    expect(result.content.filter((block) => block.type === 'text')).toHaveLength(0);
  });

  test('throws on an HTTP error with the response status and body', async () => {
    globalThis.fetch.mockResolvedValue(new Response(
      '{"error":"Tab not found"}',
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    ));
    await expect(executeScreenshot('missing-tab')).rejects.toThrow(
      '404: {"error":"Tab not found"}'
    );
  });

  test('throws when a successful response is not an image', async () => {
    globalThis.fetch.mockResolvedValue(new Response(
      '{"error":"Tab not found"}',
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));
    await expect(executeScreenshot('json-error-tab')).rejects.toThrow(
      'Screenshot failed: {"error":"Tab not found"}'
    );
  });
});
