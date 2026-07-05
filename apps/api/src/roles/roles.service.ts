import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PermissionEntity, Role } from '../entities';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/decorators';

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(PermissionEntity)
    private readonly permissions: Repository<PermissionEntity>,
    private readonly audit: AuditService,
  ) {}

  async findAll() {
    const roles = await this.roles.find({ order: { name: 'ASC' } });
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      permissions: r.permissions?.map((p) => p.code) ?? [],
    }));
  }

  private async resolvePermissions(codes: string[]): Promise<PermissionEntity[]> {
    const perms = await this.permissions.find({ where: { code: In(codes) } });
    if (perms.length !== codes.length) {
      throw new BadRequestException('One or more permission codes do not exist');
    }
    return perms;
  }

  async create(
    input: { name: string; description?: string; permissions: string[] },
    actor: AuthenticatedUser,
  ) {
    const existing = await this.roles.findOne({ where: { name: input.name } });
    if (existing) throw new BadRequestException('Role name already exists');
    const role = await this.roles.save(
      this.roles.create({
        name: input.name,
        description: input.description ?? null,
        permissions: await this.resolvePermissions(input.permissions),
      }),
    );
    this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'ROLES:CREATE',
      resourceType: 'role',
      resourceId: role.id,
      metadata: { name: role.name, permissions: input.permissions },
    });
    return role;
  }

  async update(
    id: string,
    input: { description?: string; permissions?: string[] },
    actor: AuthenticatedUser,
  ) {
    const role = await this.roles.findOne({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');
    const changes: Record<string, unknown> = {};
    if (input.description !== undefined) {
      changes.description = { from: role.description, to: input.description };
      role.description = input.description;
    }
    if (input.permissions) {
      changes.permissions = {
        from: role.permissions.map((p) => p.code),
        to: input.permissions,
      };
      role.permissions = await this.resolvePermissions(input.permissions);
    }
    const saved = await this.roles.save(role);
    this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'ROLES:UPDATE_PERMISSIONS',
      resourceType: 'role',
      resourceId: id,
      metadata: changes,
    });
    return saved;
  }
}
