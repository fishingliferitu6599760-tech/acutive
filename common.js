// データ層の共通定義
export const TABLES = {
  customers: 'customers',
  sales: 'sales',
  expenses: 'expenses',
  trips: 'trips',
  withdrawals: 'withdrawals',
  fundEntries: 'fund_entries',
};

export const DEFAULT_SETTINGS = {
  fuel_km_per_l: 12,
  fuel_yen_per_l: 170,
  service_types: ['出張施術', '鍼灸', 'その他'],
  default_service: '出張施術',
  pay_methods: ['現金', '振込', 'QR決済', 'その他'],
};

export const emptyData = () => ({ settings: { ...DEFAULT_SETTINGS }, customers: [], sales: [], expenses: [], trips: [], withdrawals: [], fundEntries: [] });

export const BACKUP_FORMAT = 'acutive-backup';
export const BACKUP_VERSION = 1;

/** 復元時の登録順（参照先が先） */
export const RESTORE_ORDER = ['customers', 'expenses', 'sales', 'trips', 'withdrawals', 'fundEntries'];

export function validateBackup(obj) {
  if (!obj || obj.format !== BACKUP_FORMAT) throw new Error('Acutiveのバックアップファイルではありません');
  if (obj.version > BACKUP_VERSION) throw new Error('新しい版のバックアップです。アプリを更新してください');
  for (const k of RESTORE_ORDER) if (!Array.isArray(obj.data?.[k])) throw new Error(`バックアップに ${k} がありません`);
  return obj;
}

/** user_id や自動項目を除いた行（別アカウント・新プロジェクトへ復元できるように） */
export function stripRow(r) {
  const { user_id, created_at, updated_at, ...rest } = r;
  return rest;
}
