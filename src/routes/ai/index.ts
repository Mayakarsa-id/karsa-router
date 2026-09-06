import { Hono } from 'hono'
import { getDb, Bindings } from '../../shared/db-client'
import { handleModels } from './models'
import { handleCombo } from './chat/combo'
import { handleSingle } from './chat/single'

const app = new Hono<{ Bindings: Bindings }>()

app.all('/*', async (c) => {
  const apiKey = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!apiKey) return c.json({ error: 'Unauthorized' }, 401)

  const db = getDb(c.env)
  const users = await db.execQuery('SELECT Username, IsVerified FROM Users WHERE APIKEY = ?', apiKey)
  if (users.length === 0) return c.json({ error: 'Invalid API Key' }, 401)
  if ((users[0] as any).IsVerified !== 1) return c.json({ error: 'User not verified' }, 403)
  const username = (users[0] as any).Username
  const providers = await db.execQuery('SELECT * FROM Providers WHERE Username = ?', username)
  if (providers.length === 0) return c.json({ error: 'Provider not found for user' }, 404)

  if (c.req.path.endsWith('/models')) {
    return handleModels(c, db, username, providers as any[])
  }

  let requestedModel: string | undefined
  let bodyTextForForward: string | undefined
  try {
    const cloned = c.req.raw.clone()
    bodyTextForForward = await cloned.text()
    if (bodyTextForForward) {
      try {
        const bodyJson = JSON.parse(bodyTextForForward) as any
        requestedModel = bodyJson?.model
      } catch {}
    }
  } catch {}

  if (requestedModel && requestedModel.startsWith('combo/')) {
    return handleCombo(c, db, apiKey, username, requestedModel, bodyTextForForward)
  }

  return handleSingle(c, db, apiKey, providers as any[], requestedModel, bodyTextForForward)
})

export default app
