import { DurableObject } from 'cloudflare:workers'

export class DBServer extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.initDb();
    });
  }

  initDb() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS Users (
        Username TEXT PRIMARY KEY,
        TotpSecret TEXT,
        APIKEY TEXT,
        Created_At TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS Providers (
        ProviderId TEXT PRIMARY KEY,
        Label TEXT,
        Prefix TEXT,
        Username TEXT,
        BaseUrl TEXT,
        Type TEXT,
        FOREIGN KEY (Username) REFERENCES Users(Username) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS Keys (
        APIKEY TEXT PRIMARY KEY,
        IsActive INTEGER DEFAULT 1,
        GeneratedAt TEXT DEFAULT CURRENT_TIMESTAMP,
        ProviderId TEXT,
        FOREIGN KEY (ProviderId) REFERENCES Providers(ProviderId) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS Usages (
        Id INTEGER PRIMARY KEY AUTOINCREMENT,
        InputToken INTEGER,
        OutputToken INTEGER,
        TriggerAt TEXT DEFAULT CURRENT_TIMESTAMP,
        APIKEY TEXT,
        FOREIGN KEY (APIKEY) REFERENCES Keys(APIKEY) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS Sessions (
        Token TEXT PRIMARY KEY,
        Username TEXT,
        ExpiresAt TEXT,
        FOREIGN KEY (Username) REFERENCES Users(Username) ON DELETE CASCADE
      );
    `);
  }

  async execQuery(sql: string, ...params: any[]) {
    return this.ctx.storage.sql.exec(sql, ...params).toArray();
  }

  async execRun(sql: string, ...params: any[]) {
    this.ctx.storage.sql.exec(sql, ...params);
    return true;
  }
}
