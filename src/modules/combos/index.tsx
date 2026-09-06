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
      <h2>Combos</h2>
      <p style="border-left:6px solid #000; padding-left:10px; font-size:13px;">Multi provider/model fallback — use <code>combo/NAME</code> as model</p>
      <form method="post" action="/combos" style="display:grid; grid-template-columns:1fr auto; gap:14px; align-items:end;">
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label>Name</label>
          <input name="Name" placeholder="e.g. fast" required pattern="[a-zA-Z0-9_-]+" title="alphanumeric dash underscore" />
        </div>
        <div><button type="submit">Create Combo</button></div>
      </form>

      <h3>Combos ({(combos as any[]).length})</h3>
      {(combos as any[]).length === 0 ? (
        <p class="card-muted">No combos yet — create one above.</p>
      ) : (
        <table>
          <thead><tr><th>Name</th><th>Model ID</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {(combos as any[]).map((co: any) => (
              <tr>
                <td><strong>{co.Name}</strong><br/><span style="font-size:11px; opacity:0.7;">{co.ComboId}</span></td>
                <td><code>combo/{co.Name}</code></td>
                <td style="font-size:12px;">{co.CreatedAt ? new Date(co.CreatedAt.replace(' ','T')+'Z').toLocaleDateString() : '-'}</td>
                <td><a href={`/combos/${co.ComboId}`}>Manage →</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p class="card" style="font-size:12px; padding:8px; border-width:2px;">Providers: {(providers as any[]).map((p:any)=>`${p.Prefix} (${p.Label})`).join(', ') || 'none — create providers first'}</p>
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
      <p><code>combo/{combo.Name}</code> — fallback in order listed</p>
      <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px;">
        <form method="post" action={`/combos/${comboId}/delete`} style="margin:0; border:none; padding:0; box-shadow:none; background:none;"><button type="submit">Delete Combo</button></form>
        <a href="/combos">← Back to Combos</a>
      </div>

      <h3>Models — fallback order ({(models as any[]).length})</h3>
      {(models as any[]).length === 0 ? (
        <p class="card-muted">No models yet — add below.</p>
      ) : (
        <table>
          <thead><tr><th>#</th><th>Provider</th><th>Model ID</th><th></th></tr></thead>
          <tbody>
            {(models as any[]).map((m: any, idx: number) => (
              <tr>
                <td>{idx + 1}</td>
                <td><code>{m.Prefix || m.ProviderId}</code><br/><span style="font-size:11px; opacity:0.7;">{m.Label || ''}</span></td>
                <td><strong>{m.ModelId}</strong></td>
                <td style="white-space:nowrap;">
                  <a href={`/combos/${comboId}/model/${m.Id}/up`}>↑</a>
                  <span> · </span>
                  <a href={`/combos/${comboId}/model/${m.Id}/down`}>↓</a>
                  <span> · </span>
                  <a href={`/combos/${comboId}/model/${m.Id}/delete`}>Remove</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Add Model</h3>
      <form method="post" action={`/combos/${comboId}/model`} style="display:grid; grid-template-columns:1fr 1fr auto; gap:14px; align-items:end;">
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label>Provider</label>
          <select name="ProviderId" required>
            <option value="">Select Provider</option>
            {(providers as any[]).map((p: any) => (
              <option value={p.ProviderId}>{p.Prefix} — {p.Label} ({p.ProviderId})</option>
            ))}
          </select>
        </div>
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label>Model ID</label>
          <input name="ModelId" placeholder="e.g. gpt-4o-mini" required />
        </div>
        <div><button type="submit">Add</button></div>
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
