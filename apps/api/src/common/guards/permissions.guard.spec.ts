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
