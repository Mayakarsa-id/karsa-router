import { Hono } from 'hono'
import { getDb, Bindings } from '../../shared/db-client'
import { Layout } from '../../shared/layout'
import { getCurrentUser } from '../../shared/auth'

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', async (c) => {
  const username = await getCurrentUser(c)
  if (!username) return c.redirect('/users/verify')
  const db = getDb(c.env)
  const combos = await db.execQuery('SELECT * FROM Combos WHERE Username = ? ORDER BY CreatedAt DESC', username)
  const providers = await db.execQuery('SELECT * FROM Providers WHERE Username = ?', username)
  return c.html(
    <Layout user={username}>
      <h2>Combos (multi provider/model fallback)</h2>
      <form method="post" action="/combos">
        <input name="Name" placeholder="Combo name (e.g. fast)" required pattern="[a-zA-Z0-9_-]+" title="alphanumeric dash underscore" />
        <button type="submit">Create Combo</button>
      </form>
      <ul>
        {(combos as any[]).map((co: any) => (
          <li><a href={`/combos/${co.ComboId}`}>{co.Name} ({co.ComboId})</a></li>
        ))}
      </ul>
      <p style="color:#666">Providers available for combo models: {(providers as any[]).map((p:any)=>`${p.Prefix} (${p.Label})`).join(', ') || 'none – create providers first'}</p>
    </Layout>
  )
})

app.post('/', async (c) => {
  const username = await getCurrentUser(c)
  if (!username) return c.redirect('/users/verify')
  const { Name } = await c.req.parseBody()
  const name = (Name as string).trim()
  if (!name) return c.redirect('/combos')
  const comboId = crypto.randomUUID().slice(0, 8)
  try {
    await getDb(c.env).execRun('INSERT INTO Combos (ComboId, Username, Name) VALUES (?, ?, ?)', comboId, username, name)
  } catch (e: any) {
    return c.text(`Failed to create combo (name must be unique): ${e?.message || e}`, 400)
  }
  return c.redirect(`/combos/${comboId}`)
})

app.get('/:id', async (c) => {
  const username = await getCurrentUser(c)
  if (!username) return c.redirect('/users/verify')
  const comboId = c.req.param('id')
  const db = getDb(c.env)
  const rows = await db.execQuery('SELECT * FROM Combos WHERE ComboId = ? AND Username = ?', comboId, username)
  if (rows.length === 0) return c.redirect('/combos')
  const combo = rows[0] as any
  const models = await db.execQuery('SELECT cm.*, p.Prefix, p.Label FROM ComboModels cm LEFT JOIN Providers p ON p.ProviderId = cm.ProviderId WHERE cm.ComboId = ? ORDER BY cm.Position, cm.Id', comboId)
  const providers = await db.execQuery('SELECT * FROM Providers WHERE Username = ?', username)
  return c.html(
    <Layout user={username}>
      <h2>Combo: {combo.Name}</h2>
      <p><code>combo/{combo.Name}</code> – used as model id for fallback</p>
      <form method="post" action={`/combos/${comboId}/delete`} style="display:inline"><button type="submit" style="color:red">Delete Combo</button></form>
      <a href="/combos">← Back</a>

      <h3>Models (fallback order)</h3>
      <ol>
        {(models as any[]).map((m: any) => (
          <li>
            {m.Prefix || m.ProviderId}/{m.ModelId} ({m.Label || ''})
            <a href={`/combos/${comboId}/model/${m.Id}/delete`} style="color:red; margin-left:10px">Remove</a>
            <a href={`/combos/${comboId}/model/${m.Id}/up`} style="margin-left:5px">↑</a>
            <a href={`/combos/${comboId}/model/${m.Id}/down`} style="margin-left:5px">↓</a>
          </li>
        ))}
        {(models as any[]).length === 0 && <li style="color:#999">No models yet</li>}
      </ol>

      <h4>Add Model</h4>
      <form method="post" action={`/combos/${comboId}/model`}>
        <select name="ProviderId" required>
          <option value="">Select Provider</option>
          {(providers as any[]).map((p: any) => (
            <option value={p.ProviderId}>{p.Prefix} – {p.Label} ({p.ProviderId})</option>
          ))}
        </select>
        <input name="ModelId" placeholder="Model id (e.g. gpt-4o-mini)" required />
        <button type="submit">Add</button>
      </form>
    </Layout>
  )
})

app.post('/:id/delete', async (c) => {
  const username = await getCurrentUser(c)
  if (!username) return c.redirect('/users/verify')
  const comboId = c.req.param('id')
  await getDb(c.env).execRun('DELETE FROM Combos WHERE ComboId = ? AND Username = ?', comboId, username)
  return c.redirect('/combos')
})

app.post('/:id/model', async (c) => {
  const username = await getCurrentUser(c)
  if (!username) return c.redirect('/users/verify')
  const comboId = c.req.param('id')
  const db = getDb(c.env)
  const combo = await db.execQuery('SELECT * FROM Combos WHERE ComboId = ? AND Username = ?', comboId, username)
  if (combo.length === 0) return c.redirect('/combos')
  const { ProviderId, ModelId } = await c.req.parseBody()
  const maxPos = await db.execQuery('SELECT COALESCE(MAX(Position), -1) as maxP FROM ComboModels WHERE ComboId = ?', comboId)
  const nextPos = ((maxPos[0] as any)?.maxP ?? -1) + 1
  await db.execRun('INSERT INTO ComboModels (ComboId, ProviderId, ModelId, Position) VALUES (?, ?, ?, ?)', comboId, ProviderId, (ModelId as string).trim(), nextPos)
  return c.redirect(`/combos/${comboId}`)
})

app.get('/:id/model/:mid/delete', async (c) => {
  const comboId = c.req.param('id')
  const mid = c.req.param('mid')
  await getDb(c.env).execRun('DELETE FROM ComboModels WHERE Id = ? AND ComboId = ?', mid, comboId)
  return c.redirect(`/combos/${comboId}`)
})

app.get('/:id/model/:mid/up', async (c) => {
  const comboId = c.req.param('id')
  const mid = c.req.param('mid')
  const db = getDb(c.env)
  const rows = await db.execQuery('SELECT * FROM ComboModels WHERE ComboId = ? ORDER BY Position, Id', comboId)
  const idx = (rows as any[]).findIndex((r) => String(r.Id) === String(mid))
  if (idx > 0) {
    const a = rows[idx] as any, b = rows[idx - 1] as any
    await db.execRun('UPDATE ComboModels SET Position = ? WHERE Id = ?', b.Position, a.Id)
    await db.execRun('UPDATE ComboModels SET Position = ? WHERE Id = ?', a.Position, b.Id)
  }
  return c.redirect(`/combos/${comboId}`)
})

app.get('/:id/model/:mid/down', async (c) => {
  const comboId = c.req.param('id')
  const mid = c.req.param('mid')
  const db = getDb(c.env)
  const rows = await db.execQuery('SELECT * FROM ComboModels WHERE ComboId = ? ORDER BY Position, Id', comboId)
  const idx = (rows as any[]).findIndex((r) => String(r.Id) === String(mid))
  if (idx >= 0 && idx < rows.length - 1) {
    const a = rows[idx] as any, b = rows[idx + 1] as any
    await db.execRun('UPDATE ComboModels SET Position = ? WHERE Id = ?', b.Position, a.Id)
    await db.execRun('UPDATE ComboModels SET Position = ? WHERE Id = ?', a.Position, b.Id)
  }
  return c.redirect(`/combos/${comboId}`)
})

export default app
