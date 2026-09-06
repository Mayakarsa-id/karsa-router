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
        IsVerified INTEGER DEFAULT 0,
        Created_At TEXT DEFAULT CURRENT_TIMESTAMP,
        InputToken INTEGER DEFAULT 0,
        OutputToken INTEGER DEFAULT 0,
        CachedToken INTEGER DEFAULT 0,
        RequestCount INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS Providers (
        ProviderId TEXT PRIMARY KEY,
        Label TEXT,
        Prefix TEXT,
        Username TEXT,
        BaseUrl TEXT,
        Type TEXT,
        TimeoutMs INTEGER DEFAULT 30000,
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
        Provider TEXT,
        Model TEXT
      );

      CREATE TABLE IF NOT EXISTS Sessions (
        Token TEXT PRIMARY KEY,
        Username TEXT,
        ExpiresAt TEXT,
        FOREIGN KEY (Username) REFERENCES Users(Username) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS Combos (
        ComboId TEXT PRIMARY KEY,
        Username TEXT,
        Name TEXT,
        CreatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (Username) REFERENCES Users(Username) ON DELETE CASCADE,
        UNIQUE(Username, Name)
      );

      CREATE TABLE IF NOT EXISTS ComboModels (
        Id INTEGER PRIMARY KEY AUTOINCREMENT,
        ComboId TEXT,
        ProviderId TEXT,
        ModelId TEXT,
        Position INTEGER DEFAULT 0,
        FOREIGN KEY (ComboId) REFERENCES Combos(ComboId) ON DELETE CASCADE,
        FOREIGN KEY (ProviderId) REFERENCES Providers(ProviderId) ON DELETE CASCADE
      );
    `);
    try {
      this.ctx.storage.sql.exec(`ALTER TABLE Users ADD COLUMN IsVerified INTEGER DEFAULT 0`);
    } catch {}
    try {
      this.ctx.storage.sql.exec(`ALTER TABLE Users ADD COLUMN APIKEY TEXT`);
    } catch {}
    // migrate Usages FK removal for existing DBs
    try {
      const info = this.ctx.storage.sql.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='Usages'`).toArray() as any[]
      if (info.length > 0 && (info[0] as any).sql.includes('FOREIGN KEY')) {
        this.ctx.storage.sql.exec(`ALTER TABLE Usages RENAME TO Usages_old`);
        this.ctx.storage.sql.exec(`CREATE TABLE Usages (Id INTEGER PRIMARY KEY AUTOINCREMENT, InputToken INTEGER, OutputToken INTEGER, TriggerAt TEXT DEFAULT CURRENT_TIMESTAMP, APIKEY TEXT, Provider TEXT, Model TEXT)`);
        this.ctx.storage.sql.exec(`INSERT INTO Usages (Id, InputToken, OutputToken, TriggerAt, APIKEY) SELECT Id, InputToken, OutputToken, TriggerAt, APIKEY FROM Usages_old`);
        this.ctx.storage.sql.exec(`DROP TABLE Usages_old`);
      }
    } catch {}
    try { this.ctx.storage.sql.exec(`ALTER TABLE Usages ADD COLUMN Provider TEXT`); } catch {}
    try { this.ctx.storage.sql.exec(`ALTER TABLE Usages ADD COLUMN Model TEXT`); } catch {}
    try { this.ctx.storage.sql.exec(`ALTER TABLE Providers ADD COLUMN TimeoutMs INTEGER DEFAULT 30000`); } catch {}
    try { this.ctx.storage.sql.exec(`ALTER TABLE Users ADD COLUMN InputToken INTEGER DEFAULT 0`); } catch {}
    try { this.ctx.storage.sql.exec(`ALTER TABLE Users ADD COLUMN OutputToken INTEGER DEFAULT 0`); } catch {}
    try { this.ctx.storage.sql.exec(`ALTER TABLE Users ADD COLUMN CachedToken INTEGER DEFAULT 0`); } catch {}
    try { this.ctx.storage.sql.exec(`ALTER TABLE Users ADD COLUMN RequestCount INTEGER DEFAULT 0`); } catch {}
  }

  async execQuery(sql: string, ...params: any[]) {
    return this.ctx.storage.sql.exec(sql, ...params).toArray();
  }

  async execRun(sql: string, ...params: any[]) {
    this.ctx.storage.sql.exec(sql, ...params);
    return true;
  }
}
