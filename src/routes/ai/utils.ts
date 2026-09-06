export function parseTokens(text: string) {
  let inputTokens = 0, outputTokens = 0, cachedTokens = 0
  const re = /"(prompt|completion|reasoning|cached)_tokens"\s*:\s*(\d+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m[1] === 'prompt') inputTokens = parseInt(m[2], 10)
    else if (m[1] === 'cached') cachedTokens = parseInt(m[2], 10)
    else outputTokens += parseInt(m[2], 10)
  }
  return { inputTokens, outputTokens, cachedTokens }
}

async function recordUsageAndUserStats(db: any, apiKey: string, providerLabel: string, model: string, inputTokens: number, outputTokens: number, cachedTokens: number) {
  await db.execRun('INSERT INTO Usages (APIKEY, InputToken, OutputToken, Provider, Model) VALUES (?, ?, ?, ?, ?)', apiKey, inputTokens, outputTokens, providerLabel, model)
  try {
    await db.execRun('UPDATE Users SET InputToken = COALESCE(InputToken,0) + ?, OutputToken = COALESCE(OutputToken,0) + ?, CachedToken = COALESCE(CachedToken,0) + ?, RequestCount = COALESCE(RequestCount,0) + 1 WHERE APIKEY = ?', inputTokens, outputTokens, cachedTokens, apiKey)
  } catch {}
}

export async function handleSuccess(resp: Response, db: any, apiKey: string, providerLabel: string, model: string) {
  const contentType = resp.headers.get('content-type') || ''
  if (contentType.includes('text/event-stream')) {
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const reader = resp.body?.getReader()
    let buffer = ''
    ;(async () => {
      if (!reader) { await writer.close(); return }
      const decoder = new TextDecoder()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          await writer.write(value)
        }
      } finally {
        try {
          const { inputTokens, outputTokens, cachedTokens } = parseTokens(buffer)
          await recordUsageAndUserStats(db, apiKey, providerLabel, model, inputTokens, outputTokens, cachedTokens)
        } catch {}
        await writer.close()
      }
    })()
    return new Response(readable, { status: resp.status, headers: new Headers(resp.headers) })
  } else {
    const rawText = await resp.text()
    const { inputTokens, outputTokens, cachedTokens } = parseTokens(rawText)
    await recordUsageAndUserStats(db, apiKey, providerLabel, model, inputTokens, outputTokens, cachedTokens)
    const headers = new Headers(resp.headers)
    headers.delete('content-length')
    headers.delete('content-encoding')
    return new Response(rawText, { status: resp.status, headers })
  }
}

export function buildTargetUrl(cUrl: string, baseUrl: string) {
  return cUrl.replace(/^.*?\/ai\/openai-compatible\/v1\//, `${baseUrl.replace(/\/$/, '')}/`)
}

export function setProviderHeaders(headers: Headers, providerKey: string, type: string) {
  headers.set('Authorization', `Bearer ${providerKey}`)
  if (type === 'anthropic') headers.set('x-api-key', providerKey)
}

export const DEFAULT_TIMEOUT_MS = 30000

export function getTimeoutMs(provider: any): number {
  const t = provider?.TimeoutMs
  if (typeof t === 'number') return t
  if (typeof t === 'string') {
    const n = parseInt(t, 10)
    if (!isNaN(n)) return n
  }
  return DEFAULT_TIMEOUT_MS
}

export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(t)
  }
}
