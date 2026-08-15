import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, permissionsForRoles, RoleName } from '@bnp/shared';
import { PermissionsGuard } from './permissions.guard';

function contextFor(user: unknown, required?: Permission[], isPublic = false) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) =>
      key === 'isPublic' ? isPublic : required,
    ),
  } as unknown as Reflector;
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  };
  return { guard: new PermissionsGuard(reflector), context: context as never };
}

const userWithRoles = (roles: RoleName[]) => ({
  userId: 'u1',
  email: 'x@bnp.health',
  roles,
  permissions: permissionsForRoles(roles),
});

describe('PermissionsGuard (RBAC)', () => {
  it('allows a nurse to ask the AI', () => {
    const { guard, context } = contextFor(userWithRoles([RoleName.NURSE_USER]), [
      Permission.AI_ASK,
    ]);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('blocks a nurse from approving documents', () => {
    const { guard, context } = contextFor(userWithRoles([RoleName.NURSE_USER]), [
      Permission.DOCUMENTS_APPROVE,
    ]);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('blocks a nurse from downloading source PDFs (copy protection)', () => {
    const { guard, context } = contextFor(userWithRoles([RoleName.NURSE_USER]), [
      Permission.DOCUMENTS_DOWNLOAD,
    ]);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows only the pharmacist to approve dose formulas', () => {
    const pharmacist = contextFor(
      userWithRoles([RoleName.PHARMACIST_REVIEWER]),
      [Permission.DOSE_FORMULAS_APPROVE],
    );
    expect(pharmacist.guard.canActivate(pharmacist.context)).toBe(true);

    const manager = contextFor(
      userWithRoles([RoleName.NURSING_KNOWLEDGE_MANAGER]),
      [Permission.DOSE_FORMULAS_APPROVE],
    );
    expect(() => manager.guard.canActivate(manager.context)).toThrow(
      ForbiddenException,
    );
  });

  it('auditor can read audit logs but cannot ask the AI', () => {
    const read = contextFor(userWithRoles([RoleName.AUDITOR]), [
      Permission.AUDIT_READ,
    ]);
    expect(read.guard.canActivate(read.context)).toBe(true);

    const ask = contextFor(userWithRoles([RoleName.AUDITOR]), [Permission.AI_ASK]);
    expect(() => ask.guard.canActivate(ask.context)).toThrow(ForbiddenException);
  });

  it('rejects unauthenticated requests to protected routes', () => {
    const { guard, context } = contextFor(undefined, [Permission.AI_ASK]);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('passes public routes through', () => {
    const { guard, context } = contextFor(undefined, [Permission.AI_ASK], true);
    expect(guard.canActivate(context)).toBe(true);
  });
});

describe('rbac.ts is the single source of truth', () => {
  it('grants nothing to a role that exists only in the database', () => {
    // A role row inserted straight into the DB has no entry in ROLE_PERMISSIONS,
    // so it authorizes nothing. This is why the roles API is read-only: editing
    // role_permissions cannot affect enforcement.
    expect(permissionsForRoles(['CUSTOM_DB_ONLY_ROLE'])).toEqual([]);

    const { guard, context } = contextFor(
      {
        userId: 'u1',
        email: 'x@bnp.health',
        roles: ['CUSTOM_DB_ONLY_ROLE'],
        permissions: permissionsForRoles(['CUSTOM_DB_ONLY_ROLE']),
      },
      [Permission.DOCUMENTS_READ],
    );
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('exposes no permission that authorizes editing role permissions', () => {
    // Removing the endpoints without removing the permission would leave a
    // capability in the matrix that grants access to nothing.
    expect(Object.values(Permission)).not.toContain('roles:manage');
  });

  it('still lets an admin manage users, which is genuinely enforced', () => {
    // Assigning users to roles is a different thing from editing what a role
    // means, and it does take effect — roles travel in the JWT.
    const { guard, context } = contextFor(
      userWithRoles([RoleName.HOSPITAL_ADMIN]),
      [Permission.USERS_MANAGE],
    );
    expect(guard.canActivate(context)).toBe(true);
  });
});
