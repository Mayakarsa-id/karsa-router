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
      <form method="post" action="/providers">
        <input name="Label" placeholder="Label" required />
        <input name="Prefix" placeholder="Prefix" required />
        <input name="BaseUrl" placeholder="Base URL" required />
        <select name="Type" required>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
        </select>
        <button type="submit">Create Provider</button>
      </form>
      <ul>
        {providers.map((p: any) => (
          <li>
            <a href={`/providers/${p.ProviderId}/edit`}>{p.Label} ({p.ProviderId})</a>
          </li>
        ))}
      </ul>
    </Layout>
  )
})

app.post('/', async (c) => {
  const username = await getCurrentUser(c)
  if (!username) return c.redirect('/users/verify')

  const { Label, Prefix, BaseUrl, Type } = await c.req.parseBody()
  if ((Prefix as string).trim().toLowerCase() === 'combo') {
    return c.text('Prefix "combo" is reserved and cannot be used', 400)
  }
  const ProviderId = crypto.randomUUID().slice(0, 8)
  await getDb(c.env).execRun(
    'INSERT INTO Providers (ProviderId, Label, Prefix, Username, BaseUrl, Type) VALUES (?, ?, ?, ?, ?, ?)',
    ProviderId, Label, Prefix, username, BaseUrl, Type
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
  const usages = await db.execQuery('SELECT * FROM Usages WHERE APIKEY IN (SELECT APIKEY FROM Keys WHERE ProviderId = ?)', providerId)

  return c.html(
    <Layout user={username}>
      <h2>Edit Provider: {provider.Label}</h2>
      <form method="post" action={`/providers/${providerId}/update`}>
        <input name="Label" defaultValue={provider.Label} required />
        <input name="Prefix" defaultValue={provider.Prefix} required />
        <input name="BaseUrl" defaultValue={provider.BaseUrl} required />
        <select name="Type" defaultValue={provider.Type} required>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
        </select>
        <button type="submit">Update</button>
      </form>
      <form method="post" action={`/providers/${providerId}/delete`}>
        <button type="submit" style={{color: 'red'}}>Delete Provider</button>
      </form>

      <h3>API Keys</h3>
      <form method="post" action={`/providers/${providerId}/add-key`}>
        <input name="APIKEY" placeholder="New API Key" required />
        <button type="submit">Add Key</button>
      </form>
      <ul>
        {keys.map((k: any) => (
          <li>{k.APIKEY} <a href={`/providers/${providerId}/delete-key/${k.APIKEY}`} style={{color: 'red'}}>Delete</a></li>
        ))}
      </ul>

      <h3>Usage Logs</h3>
      <ul>
        {usages.map((u: any) => (
          <li>Key: {u.APIKEY} | In: {u.InputToken} | Out: {u.OutputToken} | Date: {u.TriggerAt}</li>
        ))}
      </ul>
      <br />
      <a href="/providers">← Back</a>
    </Layout>
  )
})

app.post('/:id/update', async (c) => {
  const username = await getCurrentUser(c)
  if (!username) return c.redirect('/users/verify')

  const providerId = c.req.param('id')
  const { Label, Prefix, BaseUrl, Type } = await c.req.parseBody()
  if ((Prefix as string).trim().toLowerCase() === 'combo') {
    return c.text('Prefix "combo" is reserved and cannot be used', 400)
  }
  await getDb(c.env).execRun(
    'UPDATE Providers SET Label = ?, Prefix = ?, BaseUrl = ?, Type = ? WHERE ProviderId = ? AND Username = ?',
    Label, Prefix, BaseUrl, Type, providerId, username
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
