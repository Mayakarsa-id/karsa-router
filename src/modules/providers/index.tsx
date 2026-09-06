import { Hono } from 'hono'
import { getDb, Bindings } from '../../shared/db-client'
import { Layout } from '../../shared/layout'

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', async (c) => {
  const db = getDb(c.env)
  const providers = await db.execQuery('SELECT * FROM Providers')
  return c.html(
    <Layout>
      <h2>Providers</h2>
      <form method="post" action="/providers">
        <input name="ProviderId" placeholder="Provider ID" required />
        <input name="Label" placeholder="Label" required />
        <input name="Prefix" placeholder="Prefix" required />
        <input name="Username" placeholder="Username (Owner)" required />
        <button type="submit">Create Provider</button>
      </form>
      <ul>
        {providers.map((p: any) => (
          <li>{p.ProviderId} ({p.Label}) [User: {p.Username}] - <a href={`/providers/delete?id=${p.ProviderId}`}>Delete</a></li>
        ))}
      </ul>
    </Layout>
  )
})

app.post('/', async (c) => {
  const { ProviderId, Label, Prefix, Username } = await c.req.parseBody()
  await getDb(c.env).execRun('INSERT INTO Providers (ProviderId, Label, Prefix, Username) VALUES (?, ?, ?, ?)', ProviderId, Label, Prefix, Username)
  return c.redirect('/providers')
})

app.get('/delete', async (c) => {
  await getDb(c.env).execRun('DELETE FROM Providers WHERE ProviderId = ?', c.req.query('id'))
  return c.redirect('/providers')
})

export default app
