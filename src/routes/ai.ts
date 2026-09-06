import { Hono } from 'hono'
import { getDb, Bindings } from '../shared/db-client'

const app = new Hono<{ Bindings: Bindings }>()

app.all('/*', async (c) => {
  const apiKey = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!apiKey) return c.json({ error: 'Unauthorized' }, 401)

  const db = getDb(c.env)
  const users = await db.execQuery('SELECT Username, IsVerified FROM Users WHERE APIKEY = ?', apiKey)
  if (users.length === 0) return c.json({ error: 'Invalid API Key' }, 401)
  if ((users[0] as any).IsVerified !== 1) return c.json({ error: 'User not verified' }, 403)
  const username = (users[0] as any).Username
  const providers = await db.execQuery('SELECT * FROM Providers WHERE Username = ?', username)
  if (providers.length === 0) return c.json({ error: 'Provider not found for user' }, 404)

  if (c.req.path.endsWith('/models')) {
    const results = await Promise.allSettled(
      (providers as any[]).map(async (p: any) => {
        const keyRows = await db.execQuery('SELECT APIKEY FROM Keys WHERE ProviderId = ? AND IsActive = 1 LIMIT 1', p.ProviderId)
        const providerKey = keyRows.length > 0 ? (keyRows[0] as any).APIKEY : null
        const headers: Record<string, string> = {}
        if (providerKey) headers['Authorization'] = `Bearer ${providerKey}`
        if (p.Type === 'anthropic' && providerKey) headers['x-api-key'] = providerKey
        const url = `${p.BaseUrl.replace(/\/$/, '')}/models`
        const response = await fetch(url, { headers })
        if (!response.ok) throw new Error(`Failed to fetch models from ${p.Label}: ${response.status}`)
        const data = (await response.json()) as any
        const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []
        return list.map((m: any) => ({ ...m, id: `${p.Prefix}/${m.id}` }))
      })
    )
    const allModels = results.filter((r) => r.status === 'fulfilled').flatMap((r) => (r as PromiseFulfilledResult<any>).value)
    return c.json({ data: allModels, object: 'list' })
  }

  // chat/completions - route by prefix/model and fallback across API keys
  let targetProvider: any = (providers as any[])[0]
  let requestedModel: string | undefined
  let bodyTextForForward: string | undefined
  try {
    const cloned = c.req.raw.clone()
    bodyTextForForward = await cloned.text()
    if (bodyTextForForward) {
      try {
        const bodyJson = JSON.parse(bodyTextForForward) as any
        requestedModel = bodyJson?.model
        if (requestedModel && requestedModel.includes('/')) {
          const prefix = requestedModel.split('/')[0]
          const matched = (providers as any[]).find((p: any) => p.Prefix === prefix)
          if (matched) targetProvider = matched
        }
      } catch {}
    }
  } catch {}
  let forwardBody: string | undefined = bodyTextForForward
  if (requestedModel && requestedModel.includes('/') && targetProvider) {
    try {
      const j = JSON.parse(bodyTextForForward || '{}')
      j.model = requestedModel.split('/').slice(1).join('/')
      forwardBody = JSON.stringify(j)
    } catch {}
  }

  const keyRowsAll = await db.execQuery('SELECT APIKEY FROM Keys WHERE ProviderId = ? AND IsActive = 1', targetProvider.ProviderId)
  if (keyRowsAll.length === 0) return c.json({ error: 'No API keys for provider' }, 503)
  const targetUrl = c.req.url.replace(/^.*?\/ai\/openai-compatible\/v1\//, `${targetProvider.BaseUrl.replace(/\/$/, '')}/`)

  let lastResponse: Response | null = null
  for (const kr of keyRowsAll as any[]) {
    const providerKey = kr.APIKEY as string
    const forwardHeaders = new Headers(c.req.raw.headers)
    forwardHeaders.set('Authorization', `Bearer ${providerKey}`)
    if (targetProvider.Type === 'anthropic') forwardHeaders.set('x-api-key', providerKey)
    if (forwardBody && !forwardHeaders.has('content-type')) forwardHeaders.set('content-type', 'application/json')
    const resp = await fetch(targetUrl, {
      method: c.req.method,
      headers: forwardHeaders,
      body: forwardBody && c.req.method !== 'GET' && c.req.method !== 'HEAD' ? forwardBody : undefined,
    })
    if (resp.ok) {
      const contentType = resp.headers.get('content-type') || ''
      // streaming: tee and capture tokens via regex, non-streaming: buffer text
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
              let inputTokens = 0, outputTokens = 0
              const re = /"(prompt|completion|reasoning)_tokens"\s*:\s*(\d+)/g
              let m: RegExpExecArray | null
              // Use last occurrence per type: prompt overwrites, others sum
              while ((m = re.exec(buffer)) !== null) {
                if (m[1] === 'prompt') inputTokens = parseInt(m[2], 10)
                else outputTokens += parseInt(m[2], 10)
              }
              await db.execRun('INSERT INTO Usages (APIKEY, InputToken, OutputToken) VALUES (?, ?, ?)', apiKey, inputTokens, outputTokens)
            } catch {}
            await writer.close()
          }
        })()
        const headers = new Headers(resp.headers)
        return new Response(readable, { status: resp.status, headers })
      } else {
        const rawText = await resp.text()
        let inputTokens = 0, outputTokens = 0
        const re = /"(prompt|completion|reasoning)_tokens"\s*:\s*(\d+)/g
        let m: RegExpExecArray | null
        while ((m = re.exec(rawText)) !== null) {
          if (m[1] === 'prompt') inputTokens = parseInt(m[2], 10)
          else outputTokens += parseInt(m[2], 10)
        }
        await db.execRun('INSERT INTO Usages (APIKEY, InputToken, OutputToken) VALUES (?, ?, ?)', apiKey, inputTokens, outputTokens)
        const headers = new Headers(resp.headers)
        // ensure correct length after buffering
        headers.delete('content-length')
        headers.delete('content-encoding')
        return new Response(rawText, { status: resp.status, headers })
      }
    }
    lastResponse = resp
    console.log(`provider ${targetProvider.Prefix} key ${providerKey.slice(0, 8)}... failed ${resp.status}, trying next`)
  }
  if (lastResponse) {
    const errText = await lastResponse.text()
    return new Response(errText, { status: lastResponse.status, headers: lastResponse.headers })
  }
  return c.json({ error: 'All provider keys failed' }, 502)
})

export default app
