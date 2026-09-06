import { Hono } from 'hono'
import { getDb, Bindings } from '../../shared/db-client'
import { Layout } from '../../shared/layout'

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', async (c) => {
  const db = getDb(c.env)
  const keys = await db.execQuery('SELECT * FROM Keys')
  return c.html(
    <Layout>
      <h2>Keys</h2>
      <form method="post" action="/keys">
        <input name="APIKEY" placeholder="API Key" required />
        <input name="ProviderId" placeholder="Provider ID" required />
        <button type="submit">Create Key</button>
      </form>
      <ul>
        {keys.map((k: any) => (
          <li>{k.APIKEY} [Provider: {k.ProviderId}] - <a href={`/keys/delete?id=${k.APIKEY}`}>Delete</a></li>
        ))}
      </ul>
    </Layout>
  )
})

app.post('/', async (c) => {
  const { APIKEY, ProviderId } = await c.req.parseBody()
  await getDb(c.env).execRun('INSERT INTO Keys (APIKEY, ProviderId) VALUES (?, ?)', APIKEY, ProviderId)
  return c.redirect('/keys')
})

app.get('/delete', async (c) => {
  await getDb(c.env).execRun('DELETE FROM Keys WHERE APIKEY = ?', c.req.query('id'))
  return c.redirect('/keys')
})

export default app
