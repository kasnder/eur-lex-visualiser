const test = require('node:test');
const assert = require('node:assert/strict');

const { chatComplete, normalizeMessageText } = require('./openrouter-chat');

test('chatComplete passes response_format and reasoning when requested', async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;

  global.fetch = async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
        model: 'test-model',
        usage: { total_tokens: 3 },
      }),
    };
  };

  try {
    const result = await chatComplete({
      model: 'test-model',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'Return JSON.' }],
      responseFormat: 'json_object',
      reasoning: { max_tokens: 256, exclude: true },
    });

    assert.equal(result.text, '{"ok":true}');
    assert.deepEqual(capturedBody.response_format, { type: 'json_object' });
    assert.deepEqual(capturedBody.reasoning, { max_tokens: 256, exclude: true });
  } finally {
    global.fetch = originalFetch;
  }
});

test('chatComplete only starts the timeout once a semaphore slot is granted, not while queued', async () => {
  const originalFetch = global.fetch;
  let callIndex = 0;
  global.fetch = async (_url, options) => {
    const index = callIndex++;
    if (index < 3) {
      // The first three calls occupy every slot and hold it for 200ms, so
      // the 4th (queued) call sits in the queue for ~190ms before it is ever
      // admitted. With the bug (timeout armed before queue admission), that
      // wait alone exceeds the 4th call's 50ms budget and it never even gets
      // to make this request; with the fix, its 50ms timeout starts fresh
      // once admitted, comfortably beating this instantly-resolving branch.
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (options.signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        model: 'test-model',
        usage: { total_tokens: 1 },
      }),
    };
  };

  try {
    const common = { model: 'test-model', apiKey: 'test-key', messages: [{ role: 'user', content: 'hi' }] };
    // OPENROUTER_MAX_CONCURRENCY defaults to 3, so these three occupy every
    // slot and the fourth call below must queue.
    const holds = [chatComplete(common), chatComplete(common), chatComplete(common)];
    await new Promise((resolve) => setTimeout(resolve, 10));

    const queued = await chatComplete({ ...common, timeoutMs: 50 });
    assert.equal(queued.text, 'ok');

    await Promise.all(holds);
  } finally {
    global.fetch = originalFetch;
  }
});

test('chatComplete honours a caller-supplied abort signal immediately, even while queued', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (options.signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        model: 'test-model',
        usage: { total_tokens: 1 },
      }),
    };
  };

  try {
    const common = { model: 'test-model', apiKey: 'test-key', messages: [{ role: 'user', content: 'hi' }] };
    const holds = [chatComplete(common), chatComplete(common), chatComplete(common)];
    await new Promise((resolve) => setTimeout(resolve, 10));

    const controller = new AbortController();
    const queued = chatComplete({ ...common, signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const start = Date.now();
    controller.abort();
    await assert.rejects(queued, (err) => err.name === 'AbortError');
    assert.ok(Date.now() - start < 150, 'an abort while queued must reject promptly, not once a slot frees up');

    await Promise.allSettled(holds);
  } finally {
    global.fetch = originalFetch;
  }
});

test('normalizeMessageText extracts provider content parts', () => {
  assert.equal(
    normalizeMessageText([
      { type: 'text', text: '{"1":"' },
      { type: 'text', text: 'Data protection"}' },
    ]),
    '{"1":"Data protection"}'
  );
});
