import { Hono } from 'hono'
import { getDb, Bindings } from '../../shared/db-client'
import { Layout } from '../../shared/layout'
import { getCurrentUser } from '../../shared/auth'

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', async (c) => {
  const username = await getCurrentUser(c)
  if (!username) return c.redirect('/users/verify')

  const db = getDb(c.env)
  const providers = await db.execQuery('SELECT * FROM Providers WHERE Username = ?', username)
  return c.html(
    <Layout user={username}>
      <h2>My Providers</h2>
      <form method="post" action="/providers" style="display:grid; grid-template-columns:1fr 1fr; gap:14px; align-items:end;">
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label>Label</label>
          <input name="Label" placeholder="e.g. OpenAI Prod" required />
        </div>
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label>Prefix</label>
          <input name="Prefix" placeholder="e.g. openai" required />
        </div>
        <div style="display:flex; flex-direction:column; gap:6px; grid-column:span 2;">
          <label>Base URL</label>
          <input name="BaseUrl" placeholder="https://api.openai.com/v1" required />
        </div>
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label>Type</label>
          <select name="Type" required>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label>Timeout ms</label>
          <input name="TimeoutMs" placeholder="30000" type="number" min="1000" />
        </div>
        <div style="grid-column:span 2;">
          <button type="submit">Create Provider</button>
        </div>
      </form>

      <h3>Providers ({(providers as any[]).length})</h3>
      {(providers as any[]).length === 0 ? (
        <p class="card-muted">No providers yet — create one above.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Label</th><th>Prefix</th><th>Type</th><th>Base URL</th><th>Timeout</th><th></th></tr>
          </thead>
          <tbody>
            {(providers as any[]).map((p: any) => (
              <tr>
                <td><strong>{p.Label}</strong><br/><span style="font-size:11px; opacity:0.7;">{p.ProviderId}</span></td>
                <td><code>{p.Prefix}</code></td>
                <td>{p.Type}</td>
                <td style="max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title={p.BaseUrl}>{p.BaseUrl}</td>
                <td>{p.TimeoutMs || 30000} ms</td>
                <td><a href={`/providers/${p.ProviderId}/edit`}>Edit →</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  )
})

app.post('/', async (c) => {
  const username = await getCurrentUser(c)
  if (!username) return c.redirect('/users/verify')

  const { Label, Prefix, BaseUrl, Type, TimeoutMs } = await c.req.parseBody()
  if ((Prefix as string).trim().toLowerCase() === 'combo') {
    return c.text('Prefix "combo" is reserved and cannot be used', 400)
  }
  const timeout = TimeoutMs ? parseInt(TimeoutMs as string, 10) : 30000
  if (timeout < 1000 || timeout > 120000) return c.text('Timeout must be 1000-120000 ms', 400)
  const ProviderId = crypto.randomUUID().slice(0, 8)
  await getDb(c.env).execRun(
    'INSERT INTO Providers (ProviderId, Label, Prefix, Username, BaseUrl, Type, TimeoutMs) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ProviderId, Label, Prefix, username, BaseUrl, Type, timeout
  )
  return c.redirect('/providers')
})

app.get('/:id/edit', async (c) => {
  const username = await getCurrentUser(c)
  if (!username) return c.redirect('/users/verify')

  const providerId = c.req.param('id')
  const db = getDb(c.env)
  const providers = await db.execQuery('SELECT * FROM Providers WHERE ProviderId = ? AND Username = ?', providerId, username)
  if (providers.length === 0) return c.redirect('/providers')
  const provider = providers[0]
  const keys = await db.execQuery('SELECT * FROM Keys WHERE ProviderId = ?', providerId)

  return c.html(
    <Layout user={username}>
      <h2>Edit Provider: {provider.Label}</h2>
      <p><code>{provider.Prefix}</code> · <span style="font-size:12px; opacity:0.7;">{provider.ProviderId}</span></p>
      <form method="post" action={`/providers/${providerId}/update`} style="display:grid; grid-template-columns:1fr 1fr; gap:14px; align-items:end;">
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label>Label</label>
          <input name="Label" defaultValue={provider.Label} required />
        </div>
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label>Prefix</label>
          <input name="Prefix" defaultValue={provider.Prefix} required />
        </div>
        <div style="display:flex; flex-direction:column; gap:6px; grid-column:span 2;">
          <label>Base URL</label>
          <input name="BaseUrl" defaultValue={provider.BaseUrl} required />
        </div>
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label>Type</label>
          <select name="Type" defaultValue={provider.Type} required>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label>Timeout ms</label>
          <input name="TimeoutMs" defaultValue={provider.TimeoutMs || 30000} type="number" min="1000" required />
        </div>
        <div style="grid-column:span 2; display:flex; gap:10px;">
          <button type="submit">Update Provider</button>
          <a href="/providers" style="align-self:center;">← Back</a>
        </div>
      </form>
      <form method="post" action={`/providers/${providerId}/delete`} style="margin:0; border:none; padding:0; box-shadow:none; background:none;">
        <button type="submit">Delete Provider</button>
      </form>

      <h3>API Keys ({(keys as any[]).length})</h3>
      <form method="post" action={`/providers/${providerId}/add-key`} style="display:grid; grid-template-columns:1fr auto; gap:14px; align-items:end;">
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label>New API Key</label>
          <input name="APIKEY" placeholder="sk-..." required />
        </div>
        <div><button type="submit">Add Key</button></div>
      </form>
      {(keys as any[]).length === 0 ? (
        <p class="card-muted">No keys yet.</p>
      ) : (
        <table>
          <thead><tr><th>API Key</th><th></th></tr></thead>
          <tbody>
            {(keys as any[]).map((k: any) => (
              <tr>
                <td style="font-family:ui-monospace,monospace; font-size:12px; word-break:break-all;">{k.APIKEY}</td>
                <td style="white-space:nowrap;"><a href={`/providers/${providerId}/delete-key/${k.APIKEY}`}>Remove</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  )
})

app.post('/:id/update', async (c) => {
  const username = await getCurrentUser(c)
  if (!username) return c.redirect('/users/verify')

  const providerId = c.req.param('id')
  const { Label, Prefix, BaseUrl, Type, TimeoutMs } = await c.req.parseBody()
  if ((Prefix as string).trim().toLowerCase() === 'combo') {
    return c.text('Prefix "combo" is reserved and cannot be used', 400)
  }
  const timeout = TimeoutMs ? parseInt(TimeoutMs as string, 10) : 30000
  if (timeout < 1000 || timeout > 120000) return c.text('Timeout must be 1000-120000 ms', 400)
  await getDb(c.env).execRun(
    'UPDATE Providers SET Label = ?, Prefix = ?, BaseUrl = ?, Type = ?, TimeoutMs = ? WHERE ProviderId = ? AND Username = ?',
    Label, Prefix, BaseUrl, Type, timeout, providerId, username
  )
  return c.redirect(`/providers/${providerId}/edit`)
})

app.post('/:id/add-key', async (c) => {
  const username = await getCurrentUser(c)
  if (!username) return c.redirect('/users/verify')

  const providerId = c.req.param('id')
  const { APIKEY } = await c.req.parseBody()
  await getDb(c.env).execRun('INSERT INTO Keys (APIKEY, ProviderId) VALUES (?, ?)', APIKEY, providerId)
  return c.redirect(`/providers/${providerId}/edit`)
})

app.post('/:id/delete', async (c) => {
  const username = await getCurrentUser(c)
  if (!username) return c.redirect('/users/verify')

  const providerId = c.req.param('id')
  const rows = await getDb(c.env).execQuery('SELECT Prefix FROM Providers WHERE ProviderId = ? AND Username = ?', providerId, username)
  if (rows.length > 0 && (rows[0] as any).Prefix?.toLowerCase() === 'combo') {
    return c.text('Provider with prefix "combo" is reserved and cannot be deleted', 400)
  }
  await getDb(c.env).execRun('DELETE FROM Providers WHERE ProviderId = ? AND Username = ?', providerId, username)
  return c.redirect('/providers')
})

app.get('/:id/delete-key/:key', async (c) => {
  const providerId = c.req.param('id')
  const key = c.req.param('key')
  await getDb(c.env).execRun('DELETE FROM Keys WHERE APIKEY = ?', key)
  return c.redirect(`/providers/${providerId}/edit`)
})

export default app
