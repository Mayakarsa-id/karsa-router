import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { getDb, Bindings } from '../../shared/db-client'
import { Layout } from '../../shared/layout'

const app = new Hono<{ Bindings: Bindings }>()

async function getCurrentUser(c: any) {
  const token = getCookie(c, 'session')
  if (!token) return null
  const db = getDb(c.env)
  const session = await db.execQuery('SELECT Username FROM Sessions WHERE Token = ? AND ExpiresAt > datetime("now")', token)
  return session.length > 0 ? session[0].Username : null
}

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

  const { Label, Prefix } = await c.req.parseBody()
  const ProviderId = crypto.randomUUID().slice(0, 8)
  await getDb(c.env).execRun('INSERT INTO Providers (ProviderId, Label, Prefix, Username) VALUES (?, ?, ?, ?)', ProviderId, Label, Prefix, username)
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
        <button type="submit">Update</button>
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
  const { Label, Prefix } = await c.req.parseBody()
  await getDb(c.env).execRun('UPDATE Providers SET Label = ?, Prefix = ? WHERE ProviderId = ? AND Username = ?', Label, Prefix, providerId, username)
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

app.get('/:id/delete-key/:key', async (c) => {
  const providerId = c.req.param('id')
  const key = c.req.param('key')
  await getDb(c.env).execRun('DELETE FROM Keys WHERE APIKEY = ?', key)
  return c.redirect(`/providers/${providerId}/edit`)
})

export default app
