export type Bindings = {
  DB: DurableObjectNamespace
}

export const getDb = (env: Bindings) => {
  const id = env.DB.idFromName('global-db-instance')
  return env.DB.get(id)
}
