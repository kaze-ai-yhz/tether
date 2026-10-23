import 'server-only';

import type { ActingAs } from './types';

// Server-side configuration from app/web/.env.local. Tokens never leave this module except as
// the Authorization header built in snowflake.ts; nothing here is logged.

export type DataMode = 'fixtures' | 'live';

export interface ServerEnv {
  accountHost: string | null;
  patAgent: string | null;
  patClinician: string | null;
  /** One token for both acting modes (restricted to the clinician role). */
  patShared: string | null;
  roleAgent: string;
  roleClinician: string;
  warehouse: string;
  database: string;
  schema: string;
  agentName: string;
  approverLabel: string;
  dataMode: DataMode;
}

export interface Credentials {
  host: string;
  token: string;
  role: string;
  /**
   * Who enforces the acting role. 'snowflake': the acting role has its own role-restricted token.
   * 'app': Care agent mode runs on the shared clinician token, so the app refuses clinician-only calls.
   */
  enforcement: 'snowflake' | 'app';
}

/** Live only when DATA_MODE=live and the host and the acting role's token are set. */
export type EffectiveMode = { mode: 'live'; credentials: Credentials } | { mode: 'fixtures'; reason: string };

function read(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/** Accepts 'org-acct.snowflakecomputing.com' or a full https URL; returns the bare host. */
function normalizeHost(raw: string | null): string | null {
  if (!raw) return null;
  const host = raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
  return /^[a-z0-9.-]+$/.test(host) ? host : null;
}

export function getEnv(): ServerEnv {
  return {
    accountHost: normalizeHost(read('SNOWFLAKE_ACCOUNT_HOST')),
    patAgent: read('SNOWFLAKE_PAT_AGENT'),
    patClinician: read('SNOWFLAKE_PAT_CLINICIAN'),
    patShared: read('SNOWFLAKE_PAT'),
    roleAgent: read('SNOWFLAKE_ROLE_AGENT') ?? 'CARE_AGENT_ROLE',
    roleClinician: read('SNOWFLAKE_ROLE_CLINICIAN') ?? 'CLINICIAN_ROLE',
    warehouse: read('SNOWFLAKE_WAREHOUSE') ?? 'DEFAULT_WH',
    database: read('SNOWFLAKE_DATABASE') ?? 'CARE_RULES',
    schema: read('SNOWFLAKE_SCHEMA') ?? 'CORE',
    agentName: read('SNOWFLAKE_AGENT_NAME') ?? 'TETHER_ASK',
    approverLabel: read('APPROVER_LABEL') ?? 'Clinician',
    dataMode: read('DATA_MODE')?.toLowerCase() === 'live' ? 'live' : 'fixtures',
  };
}

export function roleFor(actingAs: ActingAs, env: ServerEnv = getEnv()): string {
  return actingAs === 'agent' ? env.roleAgent : env.roleClinician;
}

export function effectiveMode(actingAs: ActingAs, env: ServerEnv = getEnv()): EffectiveMode {
  if (env.dataMode !== 'live') return { mode: 'fixtures', reason: 'DATA_MODE is fixtures' };
  if (!env.accountHost) return { mode: 'fixtures', reason: 'SNOWFLAKE_ACCOUNT_HOST is not set' };
  const ownToken = actingAs === 'agent' ? env.patAgent : env.patClinician;
  if (ownToken) {
    return {
      mode: 'live',
      credentials: { host: env.accountHost, token: ownToken, role: roleFor(actingAs, env), enforcement: 'snowflake' },
    };
  }
  if (env.patShared) {
    // The shared token is restricted to the clinician role, so every request runs as that role.
    return {
      mode: 'live',
      credentials: {
        host: env.accountHost,
        token: env.patShared,
        role: env.roleClinician,
        enforcement: actingAs === 'agent' ? 'app' : 'snowflake',
      },
    };
  }
  const name = actingAs === 'agent' ? 'SNOWFLAKE_PAT_AGENT' : 'SNOWFLAKE_PAT_CLINICIAN';
  return { mode: 'fixtures', reason: `Neither SNOWFLAKE_PAT nor ${name} is set` };
}
