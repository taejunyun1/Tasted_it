import type { AppDb } from "../../db/client.server";
import { sql } from "drizzle-orm";

export class AccountRestrictedError extends Error {
  constructor() { super("ACCOUNT_RESTRICTED"); this.name = "AccountRestrictedError"; }
}
export class AccountAccessChangedError extends Error {
  constructor() { super("ACCOUNT_ACCESS_CHANGED"); this.name = "AccountAccessChangedError"; }
}
export function isAccountRestrictedError(error: unknown) {
  for (let depth = 0; depth < 4 && error instanceof Error; depth++) {
    if (error instanceof AccountRestrictedError || /ACCOUNT_(?:RESTRICTED|ACCESS_CHANGED)/.test(error.message)) return true;
    error = error.cause;
  }
  return false;
}
export const ACCOUNT_RESTRICTED_MESSAGE = "계정 접근이 제한되었거나 접근 상태가 변경되었습니다. 새로 로그인하거나 운영자에게 문의해 주세요.";
export async function assertMemberAccess(db: AppDb, userId: string, now = new Date().toISOString()) {
  const row = await db.get<{ user_id: string }>(sql`SELECT user_id FROM member_access_restrictions
    WHERE user_id=${userId} AND lifted_at IS NULL AND starts_at<=${now} AND expires_at>${now}`);
  if (row) throw new AccountRestrictedError();
}
export async function assertFreshMemberAuthentication(db: AppDb,userId:string,authenticatedAt:string) {
  const changed=await db.get<{user_id:string}>(sql`SELECT user_id FROM member_access_restrictions WHERE user_id=${userId} AND updated_at>${authenticatedAt}`);
  if(changed) throw new AccountAccessChangedError();
}
