const { CapacityError, createSemaphore } = require('./concurrency');

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

// Nothing else bounds how many model calls this process can have in flight:
// each cache miss on an AI endpoint starts one, and a burst of distinct laws
// means a burst of concurrent (billed) generations. Queue them instead, and
// shed load once the queue is deep enough that waiting is pointless.
const OPENROUTER_MAX_CONCURRENCY = Number(process.env.OPENROUTER_MAX_CONCURRENCY) > 0
  ? Number(process.env.OPENROUTER_MAX_CONCURRENCY)
  : 3;
const OPENROUTER_MAX_QUEUE = Number(process.env.OPENROUTER_MAX_QUEUE) > 0
  ? Number(process.env.OPENROUTER_MAX_QUEUE)
  : 20;

const chatSemaphore = createSemaphore({
  limit: OPENROUTER_MAX_CONCURRENCY,
  maxQueue: OPENROUTER_MAX_QUEUE,
  name: 'OpenRouter chat',
});

// Hard ceiling on a single chat call. Without it a stalled provider holds the
// HTTP request open for as long as undici tolerates a trickling body — minutes
// — while the model keeps generating (and billing) for a client that may be
// long gone. Generous because whole-law digests legitimately take a while.
const DEFAULT_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS) > 0
  ? Number(process.env.OPENROUTER_TIMEOUT_MS)
  : 120_000;

// Combine the caller's signal (if any) with the default timeout so passing an
// explicit signal never silently disables the ceiling.
function withTimeout(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

// Rejects as soon as `signal` aborts, so a caller-initiated abort takes
// effect even while the request is still queued for a semaphore slot (the
// fetch itself isn't running yet, so it has nothing to abort). Once the slot
// is acquired, the in-flight fetch is aborted normally via its own signal.
//
// Returns a `cancel` alongside the promise because the listener outlives the
// race when the request wins it: a caller that reuses one long-lived signal
// across many calls would otherwise accumulate a listener per call. Passing
// an AbortSignal to addEventListener is the documented way to detach it.
function abortRejection(signal) {
  if (signal.aborted) {
    return {
      promise: Promise.reject(new DOMException('The operation was aborted.', 'AbortError')),
      cancel: () => {},
    };
  }
  const detach = new AbortController();
  const promise = new Promise((_, reject) => {
    signal.addEventListener(
      'abort',
      () => reject(new DOMException('The operation was aborted.', 'AbortError')),
      { once: true, signal: detach.signal }
    );
  });
  return { promise, cancel: () => detach.abort() };
}

class ChatProviderError extends Error {
  constructor(message, { status = 500, code = null, details = null } = {}) {
    super(message);
    this.name = 'ChatProviderError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function readErrorBody(res) {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    try { return { message: await res.text() }; } catch { return {}; }
  }
  try { return await res.json(); } catch { return {}; }
}

function normalizeMessageText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        if (typeof part.text === 'string') return part.text;
        if (typeof part.content === 'string') return part.content;
        if (typeof part.value === 'string') return part.value;
        return '';
      })
      .join('')
      .trim();
  }
  if (typeof value.text === 'string') return value.text.trim();
  if (typeof value.content === 'string') return value.content.trim();
  return '';
}

async function chatComplete({
  model,
  messages,
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  temperature = 0.2,
  maxTokens = 1500,
  responseFormat = null,
  reasoning = null,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!apiKey) {
    throw new ChatProviderError('OPENROUTER_API_KEY is required', { status: 503, code: 'missing_api_key' });
  }
  // Keep the caller's own signal (if any) separate from the per-call timeout:
  // the timeout must only start once the request actually begins sending (see
  // below), but an explicit caller abort has to take effect immediately, even
  // while the request is still queued on the semaphore.
  const callerSignal = signal;
  const url = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;
  const body = { model, messages, temperature, max_tokens: maxTokens };
  if (responseFormat) {
    body.response_format = typeof responseFormat === 'string'
      ? { type: responseFormat }
      : responseFormat;
  }
  if (reasoning) {
    body.reasoning = reasoning;
  }
  let data;
  try {
    // The slot is held until the response body has been read, so `limit` is
    // really the number of generations this process can be paying for at once.
    const runPromise = chatSemaphore.run(async () => {
      // Arm the timeout here, immediately before the fetch, not before the
      // semaphore admits this call — otherwise time spent waiting in the
      // queue is charged against the request's own timeout budget, and a
      // queued request can time out having never been sent.
      const requestSignal = withTimeout(callerSignal, timeoutMs);
      const res = await fetch(url, {
        method: 'POST',
        signal: requestSignal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://legalviz.local',
          'X-Title': 'EUR-Lex Visualiser',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errorBody = await readErrorBody(res);
        throw new ChatProviderError(
          errorBody?.error?.message || errorBody?.message || res.statusText || 'Chat request failed',
          { status: res.status, code: errorBody?.error?.code || null, details: errorBody }
        );
      }
      return res.json();
    });
    // Prevent an unhandled-rejection warning if the abort race below wins
    // first and nothing else ever observes runPromise's eventual rejection.
    runPromise.catch(() => {});

    if (callerSignal) {
      const abort = abortRejection(callerSignal);
      // Swallow the loser's rejection either way: whichever promise the race
      // discards still settles, and an unobserved rejection would surface as
      // an unhandled-rejection warning.
      abort.promise.catch(() => {});
      try {
        data = await Promise.race([runPromise, abort.promise]);
      } finally {
        abort.cancel();
      }
    } else {
      data = await runPromise;
    }
  } catch (err) {
    if (err instanceof CapacityError) {
      throw new ChatProviderError('Too many AI generations in progress; please retry shortly', {
        status: 429,
        code: 'chat_capacity_exceeded',
      });
    }
    throw err;
  }
  const msg = data?.choices?.[0]?.message || {};
  // Some reasoning models (e.g. gpt-oss) put the final answer in `content`
  // but burn tokens on `reasoning` first; if content is empty, fall back to reasoning.
  const text = normalizeMessageText(msg.content) || normalizeMessageText(msg.reasoning) || '';
  return {
    text,
    usage: data?.usage || null,
    model: data?.model || model,
    finishReason: data?.choices?.[0]?.finish_reason || null,
  };
}

/**
 * Streaming variant — yields incremental events:
 *   { type: 'delta', text }         for each content chunk
 *   { type: 'done', usage, model }  once at the end
 * Throws ChatProviderError on upstream failure (incl. 402 insufficient credits).
 *
 * INTENTIONALLY UNGUARDED: unlike chatComplete, this does not go through
 * chatSemaphore — it is currently unused (referenced only by module.exports),
 * so there is no established concurrency contract for it yet. Wrapping an
 * async generator in chatSemaphore.run() the same way chatComplete does would
 * hold a slot open for the whole lifetime of the stream (which chatComplete
 * never does — it holds a slot only until the response body is read), a very
 * different capacity cost. Before this is ever wired up to a real caller, it
 * must acquire a slot itself with a strategy suited to a long-lived stream.
 */
async function* chatStream({
  model,
  messages,
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  temperature = 0.2,
  maxTokens = 1500,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!apiKey) {
    throw new ChatProviderError('OPENROUTER_API_KEY is required', { status: 503, code: 'missing_api_key' });
  }
  signal = withTimeout(signal, timeoutMs);
  const url = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://legalviz.local',
      'X-Title': 'EUR-Lex Visualiser',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream: true, usage: { include: true } }),
  });
  if (!res.ok) {
    const body = await readErrorBody(res);
    throw new ChatProviderError(
      body?.error?.message || body?.message || res.statusText || 'Chat request failed',
      { status: res.status, code: body?.error?.code || null, details: body }
    );
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let finalUsage = null;
  let finalModel = model;
  let reasoningFallback = '';
  let sawContent = false;

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    // SSE frames are separated by blank lines
    let sepIndex;
    while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let obj;
        try { obj = JSON.parse(payload); } catch { continue; }
        if (obj.usage) finalUsage = obj.usage;
        if (obj.model) finalModel = obj.model;
        const delta = obj.choices?.[0]?.delta || {};
        if (typeof delta.content === 'string' && delta.content.length) {
          sawContent = true;
          yield { type: 'delta', text: delta.content };
        } else if (typeof delta.reasoning === 'string' && delta.reasoning.length) {
          reasoningFallback += delta.reasoning;
        }
        // Some providers attach usage on the final chunk via message
        const msg = obj.choices?.[0]?.message;
        if (msg?.content) {
          sawContent = true;
          yield { type: 'delta', text: msg.content };
        }
      }
    }
  }

  // If content never came through (reasoning model with no final content),
  // fall back to reasoning so the user sees something.
  if (!sawContent && reasoningFallback) {
    yield { type: 'delta', text: reasoningFallback };
  }

  yield { type: 'done', usage: finalUsage, model: finalModel };
}

module.exports = { chatComplete, chatStream, ChatProviderError, normalizeMessageText };
