/**
 * Settings repository - Artupski ReSite
 *
 * Key/value application settings backed by `app_settings`. Values are stored as
 * text; callers own any JSON encoding. `set` upserts and always refreshes
 * `updated_at`.
 */
import type { AppSetting } from '../../../types/models';
import type { StorageContext } from '../context';
import { toAppSetting, type AppSettingRow } from '../types';

const COLUMNS = 'key, value, updated_at';

export class SettingsRepository {
  private readonly context: StorageContext;

  constructor(context: StorageContext) {
    this.context = context;
  }

  async get(key: string): Promise<AppSetting | null> {
    const row = this.context
      .getDatabase()
      .get<AppSettingRow>(`SELECT ${COLUMNS} FROM app_settings WHERE key = ?;`, [key]);
    return row ? toAppSetting(row) : null;
  }

  async set(key: string, value: string): Promise<AppSetting> {
    const db = this.context.getDatabase();
    db.run(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;`,
      [key, value]
    );
    const row = db.get<AppSettingRow>(`SELECT ${COLUMNS} FROM app_settings WHERE key = ?;`, [key]);
    await this.context.persist();
    return toAppSetting(row as AppSettingRow);
  }

  async delete(key: string): Promise<boolean> {
    const db = this.context.getDatabase();
    const result = db.run('DELETE FROM app_settings WHERE key = ?;', [key]);
    if (result.changes > 0) {
      await this.context.persist();
      return true;
    }
    return false;
  }

  async getAll(): Promise<AppSetting[]> {
    const rows = this.context
      .getDatabase()
      .all<AppSettingRow>(`SELECT ${COLUMNS} FROM app_settings ORDER BY key ASC;`);
    return rows.map(toAppSetting);
  }
}
