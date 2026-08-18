import { Controller, Get } from '@nestjs/common';
import { Permission } from '@bnp/shared';
import { Permissions } from '../common/decorators';
import { RolesService } from './roles.service';

/**
 * Roles are read-only over the API.
 *
 * `packages/shared/src/rbac.ts` is the single source of truth for what each
 * role may do: PermissionsGuard checks the permissions JwtStrategy derives
 * from that matrix, and never reads the database. The roles and
 * role_permissions tables exist so the UI can *show* the matrix and so users
 * can be assigned to roles — they are not consulted when a request is
 * authorized.
 *
 * This controller previously also exposed POST /roles and PATCH /roles/:id.
 * Both wrote to role_permissions, returned success and emitted a
 * ROLES:UPDATE_PERMISSIONS audit entry, while changing nothing about what any
 * user could actually do. An access-control API that reports a change it did
 * not make is worse than none, so they are gone. Change a role's permissions
 * in rbac.ts, where the change is type-checked, test-covered and reviewed.
 *
 * Assigning users to roles is a different thing and still works: see
 * POST /users and PATCH /users/:id, which are genuinely enforced because
 * roles travel in the JWT.
 */
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @Permissions(Permission.ROLES_READ)
  findAll() {
    return this.roles.findAll();
  }
}
