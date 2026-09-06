import { buildTargetUrl, setProviderHeaders, handleSuccess } from '../utils'

export async function handleSingle(c: any, db: any, apiKey: string, providers: any[], requestedModel: string | undefined, bodyTextForForward: string | undefined) {
  let targetProvider: any = providers[0]
  let literalModel = requestedModel || ''
  if (requestedModel && requestedModel.includes('/')) {
    const prefix = requestedModel.split('/')[0]
    const matched = providers.find((p: any) => p.Prefix === prefix)
    if (matched) targetProvider = matched
  }
  let forwardBody: string | undefined = bodyTextForForward
  if (requestedModel && requestedModel.includes('/') && targetProvider) {
    const prefix = requestedModel.split('/')[0]
    if (targetProvider.Prefix === prefix) {
      literalModel = requestedModel.split('/').slice(1).join('/')
      try {
        const j = JSON.parse(bodyTextForForward || '{}')
        j.model = literalModel
        forwardBody = JSON.stringify(j)
      } catch {}
    }
  }

  const keyRowsAll = (await db.execQuery('SELECT APIKEY FROM Keys WHERE ProviderId = ? AND IsActive = 1', targetProvider.ProviderId)) as any[]
  if (keyRowsAll.length === 0) return c.json({ error: 'No API keys for provider' }, 503)
  const targetUrl = buildTargetUrl(c.req.url, targetProvider.BaseUrl)

  let lastResponse: Response | null = null
  for (const kr of keyRowsAll) {
    const providerKey = kr.APIKEY as string
    const forwardHeaders = new Headers(c.req.raw.headers)
    setProviderHeaders(forwardHeaders, providerKey, targetProvider.Type)
    if (forwardBody && !forwardHeaders.has('content-type')) forwardHeaders.set('content-type', 'application/json')
    const resp = await fetch(targetUrl, {
      method: c.req.method,
      headers: forwardHeaders,
      body: forwardBody && c.req.method !== 'GET' && c.req.method !== 'HEAD' ? forwardBody : undefined,
    })
    if (resp.ok) return await handleSuccess(resp, db, apiKey, targetProvider.Prefix, literalModel)
    lastResponse = resp
    console.log(`provider ${targetProvider.Prefix} key ${providerKey.slice(0, 8)}... failed ${resp.status}, trying next`)
  }
  if (lastResponse) {
    const errText = await lastResponse.text()
    return new Response(errText, { status: lastResponse.status, headers: lastResponse.headers })
  }
  return c.json({ error: 'All provider keys failed' }, 502)
}
