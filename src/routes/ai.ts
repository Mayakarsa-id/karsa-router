import { Hono } from 'hono'
import { getDb, Bindings } from '../shared/db-client'

const app = new Hono<{ Bindings: Bindings }>()

function parseTokens(text: string) {
  let inputTokens = 0, outputTokens = 0
  const re = /"(prompt|completion|reasoning)_tokens"\s*:\s*(\d+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m[1] === 'prompt') inputTokens = parseInt(m[2], 10)
    else outputTokens += parseInt(m[2], 10)
  }
  return { inputTokens, outputTokens }
}

async function handleSuccess(resp: Response, db: any, apiKey: string, providerLabel: string, requestedModel: string) {
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
          const { inputTokens, outputTokens } = parseTokens(buffer)
          await db.execRun('INSERT INTO Usages (APIKEY, InputToken, OutputToken, Provider, Model) VALUES (?, ?, ?, ?, ?)', apiKey, inputTokens, outputTokens, providerLabel, requestedModel || '')
        } catch {}
        await writer.close()
      }
    })()
    return new Response(readable, { status: resp.status, headers: new Headers(resp.headers) })
  } else {
    const rawText = await resp.text()
    const { inputTokens, outputTokens } = parseTokens(rawText)
    await db.execRun('INSERT INTO Usages (APIKEY, InputToken, OutputToken, Provider, Model) VALUES (?, ?, ?, ?, ?)', apiKey, inputTokens, outputTokens, providerLabel, requestedModel || '')
    const headers = new Headers(resp.headers)
    headers.delete('content-length')
    headers.delete('content-encoding')
    return new Response(rawText, { status: resp.status, headers })
  }
}

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
    // add combos
    const combos = await db.execQuery('SELECT * FROM Combos WHERE Username = ?', username) as any[]
    const comboModels = combos.map((co: any) => ({
      id: `combo/${co.Name}`,
      object: 'model',
      created: co.CreatedAt ? Math.floor(new Date(co.CreatedAt).getTime() / 1000) : 0,
      owned_by: username,
    }))
    return c.json({ data: [...allModels, ...comboModels], object: 'list' })
  }

  // chat/completions - route by prefix/model or combo and fallback
  let requestedModel: string | undefined
  let bodyTextForForward: string | undefined
  try {
    const cloned = c.req.raw.clone()
    bodyTextForForward = await cloned.text()
    if (bodyTextForForward) {
      try {
        const bodyJson = JSON.parse(bodyTextForForward) as any
        requestedModel = bodyJson?.model
      } catch {}
    }
  } catch {}

  // combo handling: model starts with combo/
  if (requestedModel && requestedModel.startsWith('combo/')) {
    const comboName = requestedModel.slice('combo/'.length)
    const comboRows = await db.execQuery('SELECT * FROM Combos WHERE Username = ? AND Name = ?', username, comboName) as any[]
    if (comboRows.length === 0) return c.json({ error: `Combo not found: ${comboName}` }, 404)
    const combo = comboRows[0]
    const comboEntries = await db.execQuery('SELECT cm.*, p.Prefix, p.Label, p.BaseUrl, p.Type FROM ComboModels cm JOIN Providers p ON p.ProviderId = cm.ProviderId WHERE cm.ComboId = ? ORDER BY cm.Position, cm.Id', combo.ComboId) as any[]
    if (comboEntries.length === 0) return c.json({ error: 'Combo has no models' }, 404)

    let lastResponse: Response | null = null
    for (const entry of comboEntries as any[]) {
      const provider = { ProviderId: entry.ProviderId, Prefix: entry.Prefix, Label: entry.Label, BaseUrl: entry.BaseUrl, Type: entry.Type }
      const strippedModel = entry.ModelId
      let forwardBody: string | undefined = bodyTextForForward
      try {
        const j = JSON.parse(bodyTextForForward || '{}')
        j.model = strippedModel
        forwardBody = JSON.stringify(j)
      } catch {}
      const targetUrl = c.req.url.replace(/^.*?\/ai\/openai-compatible\/v1\//, `${provider.BaseUrl.replace(/\/$/, '')}/`)
      const keyRowsAll = await db.execQuery('SELECT APIKEY FROM Keys WHERE ProviderId = ? AND IsActive = 1', provider.ProviderId) as any[]
      if (keyRowsAll.length === 0) { lastResponse = new Response(`No keys for provider ${provider.Prefix}`, { status: 503 }); continue }
      for (const kr of keyRowsAll) {
        const providerKey = kr.APIKEY as string
        const forwardHeaders = new Headers(c.req.raw.headers)
        forwardHeaders.set('Authorization', `Bearer ${providerKey}`)
        if (provider.Type === 'anthropic') forwardHeaders.set('x-api-key', providerKey)
        if (forwardBody && !forwardHeaders.has('content-type')) forwardHeaders.set('content-type', 'application/json')
        const resp = await fetch(targetUrl, {
          method: c.req.method,
          headers: forwardHeaders,
          body: forwardBody && c.req.method !== 'GET' && c.req.method !== 'HEAD' ? forwardBody : undefined,
        })
        if (resp.ok) {
          return await handleSuccess(resp, db, apiKey, `combo/${combo.Name}`, requestedModel)
        }
        lastResponse = resp
        console.log(`combo ${combo.Name} provider ${provider.Prefix}/${strippedModel} key ${providerKey.slice(0,8)}... failed ${resp.status}, trying next`)
      }
    }
    if (lastResponse) {
      const errText = await lastResponse.text()
      return new Response(errText, { status: lastResponse.status, headers: lastResponse.headers })
    }
    return c.json({ error: 'All combo models/keys failed' }, 502)
  }

  // single provider/model path
  let targetProvider: any = (providers as any[])[0]
  if (requestedModel && requestedModel.includes('/')) {
    const prefix = requestedModel.split('/')[0]
    const matched = (providers as any[]).find((p: any) => p.Prefix === prefix)
    if (matched) targetProvider = matched
  }
  let forwardBody: string | undefined = bodyTextForForward
  if (requestedModel && requestedModel.includes('/') && targetProvider) {
    // if matched by prefix, strip it
    const prefix = requestedModel.split('/')[0]
    if (targetProvider.Prefix === prefix) {
      try {
        const j = JSON.parse(bodyTextForForward || '{}')
        j.model = requestedModel.split('/').slice(1).join('/')
        forwardBody = JSON.stringify(j)
      } catch {}
    }
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
      return await handleSuccess(resp, db, apiKey, targetProvider.Prefix || targetProvider.Label, requestedModel || '')
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
