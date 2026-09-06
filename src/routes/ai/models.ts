import { getDb } from '../../shared/db-client'

export async function handleModels(c: any, db: any, username: string, providers: any[]) {
  const results = await Promise.allSettled(
    providers.map(async (p: any) => {
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
  const combos = (await db.execQuery('SELECT * FROM Combos WHERE Username = ?', username)) as any[]
  const comboModels = combos.map((co: any) => ({
    id: `combo/${co.Name}`,
    object: 'model',
    created: co.CreatedAt ? Math.floor(new Date(co.CreatedAt).getTime() / 1000) : 0,
    owned_by: username,
  }))
  return c.json({ data: [...allModels, ...comboModels], object: 'list' })
}
