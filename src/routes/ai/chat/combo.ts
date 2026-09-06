import { buildTargetUrl, setProviderHeaders, handleSuccess, fetchWithTimeout, getTimeoutMs } from '../utils'

export async function handleCombo(c: any, db: any, apiKey: string, username: string, requestedModel: string, bodyTextForForward: string | undefined) {
  const comboName = requestedModel.slice('combo/'.length)
  const comboRows = (await db.execQuery('SELECT * FROM Combos WHERE Username = ? AND Name = ?', username, comboName)) as any[]
  if (comboRows.length === 0) return c.json({ error: `Combo not found: ${comboName}` }, 404)
  const combo = comboRows[0]
  const comboEntries = (await db.execQuery('SELECT cm.*, p.Prefix, p.Label, p.BaseUrl, p.Type, p.TimeoutMs FROM ComboModels cm JOIN Providers p ON p.ProviderId = cm.ProviderId WHERE cm.ComboId = ? ORDER BY cm.Position, cm.Id', combo.ComboId)) as any[]
  if (comboEntries.length === 0) return c.json({ error: 'Combo has no models' }, 404)

  let lastResponse: Response | null = null
  for (const entry of comboEntries) {
    const provider = { ProviderId: entry.ProviderId, Prefix: entry.Prefix, Label: entry.Label, BaseUrl: entry.BaseUrl, Type: entry.Type, TimeoutMs: (entry as any).TimeoutMs }
    const strippedModel = entry.ModelId
    let forwardBody: string | undefined = bodyTextForForward
    try {
      const j = JSON.parse(bodyTextForForward || '{}')
      j.model = strippedModel
      forwardBody = JSON.stringify(j)
    } catch {}
    const targetUrl = buildTargetUrl(c.req.url, provider.BaseUrl)
    const keyRowsAll = (await db.execQuery('SELECT APIKEY FROM Keys WHERE ProviderId = ? AND IsActive = 1', provider.ProviderId)) as any[]
    if (keyRowsAll.length === 0) { lastResponse = new Response(`No keys for provider ${provider.Prefix}`, { status: 503 }); continue }
    const timeout = getTimeoutMs(provider)
    for (const kr of keyRowsAll) {
      const providerKey = kr.APIKEY as string
      const forwardHeaders = new Headers(c.req.raw.headers)
      setProviderHeaders(forwardHeaders, providerKey, provider.Type)
      if (forwardBody && !forwardHeaders.has('content-type')) forwardHeaders.set('content-type', 'application/json')
      let resp: Response
      try {
        resp = await fetchWithTimeout(targetUrl, {
          method: c.req.method,
          headers: forwardHeaders,
          body: forwardBody && c.req.method !== 'GET' && c.req.method !== 'HEAD' ? forwardBody : undefined,
        }, timeout)
      } catch (e: any) {
        console.log(`combo ${combo.Name} provider ${provider.Prefix}/${strippedModel} key ${providerKey.slice(0, 8)}... timeout/error ${e?.message || e}, trying next`)
        lastResponse = new Response(`Provider ${provider.Prefix} timeout: ${e?.message || e}`, { status: 504 })
        continue
      }
      if (resp.ok) return await handleSuccess(resp, db, apiKey, entry.Prefix, strippedModel)
      lastResponse = resp
      console.log(`combo ${combo.Name} provider ${provider.Prefix}/${strippedModel} key ${providerKey.slice(0, 8)}... failed ${resp.status}, trying next`)
    }
  }
  if (lastResponse) {
    const errText = await lastResponse.text()
    return new Response(errText, { status: lastResponse.status, headers: lastResponse.headers })
  }
  return c.json({ error: 'All combo models/keys failed' }, 502)
}
