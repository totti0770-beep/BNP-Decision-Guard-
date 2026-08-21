import { RoleName } from '@bnp/shared';

/**
 * The demo accounts the seed creates, and the passwords it creates them with
 * when no override is set.
 *
 * These literals are **published** — they are in `README.md` and in this
 * public repository. Treating them as secrets would be theatre; treating them
 * as *known-compromised* is the honest model, and it is why they live in one
 * place. Two consumers need the same list for opposite reasons:
 *
 * - `seed/seed.ts` creates the accounts from it (development and demo only).
 * - `auth/demo-account-guard.service.ts` uses it in production to detect an
 *   account still carrying one of these passwords and disable it.
 *
 * That second consumer is why `defaultPassword` must stay the *shipped*
 * literal and must never read `SEED_PASSWORD_*`. An operator who set an
 * override chose a real secret; comparing against the override would disable
 * a properly-provisioned account. Comparing against the literal can only ever
 * match an account nobody rotated.
 */
export interface DemoAccount {
  email: string;
  /** The shipped default. Public knowledge — never a real secret. */
  defaultPassword: string;
  fullName: string;
  role: RoleName;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { email: 'superadmin@bnp.health', defaultPassword: 'SuperAdmin123!', fullName: 'Sara Al-Otaibi', role: RoleName.SUPER_ADMIN },
  { email: 'admin@bnp.health', defaultPassword: 'HospAdmin123!', fullName: 'Mohammed Al-Harbi', role: RoleName.HOSPITAL_ADMIN },
  { email: 'knowledge@bnp.health', defaultPassword: 'Knowledge123!', fullName: 'Noura Al-Qahtani', role: RoleName.NURSING_KNOWLEDGE_MANAGER },
  { email: 'pharmacist@bnp.health', defaultPassword: 'Pharmacist123!', fullName: 'Khalid Al-Zahrani', role: RoleName.PHARMACIST_REVIEWER },
  { email: 'quality@bnp.health', defaultPassword: 'Quality123!', fullName: 'Amal Al-Shehri', role: RoleName.CBAHI_QUALITY_OFFICER },
  { email: 'nurse@bnp.health', defaultPassword: 'NurseUser123!', fullName: 'Fatimah Al-Ghamdi', role: RoleName.NURSE_USER },
  { email: 'auditor@bnp.health', defaultPassword: 'Auditor123!', fullName: 'Yousef Al-Dossary', role: RoleName.AUDITOR },
] as const;

/** The env var that overrides a role's seeded password, e.g. `SEED_PASSWORD_NURSE_USER`. */
export function seedPasswordEnvVar(role: RoleName): string {
  return `SEED_PASSWORD_${role}`;
}

/**
 * The password the seed will actually use: the operator's override when set,
 * otherwise the published default.
 *
 * Only the seed should call this. The guard deliberately reads
 * `account.defaultPassword` instead — see the note above.
 */
export function seedPasswordFor(account: DemoAccount): string {
  return process.env[seedPasswordEnvVar(account.role)] || account.defaultPassword;
}
