import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../entities';

/**
 * Read-only view of the seeded role catalogue, for display and for populating
 * role pickers. Mutation lives in packages/shared/src/rbac.ts — see the note
 * on RolesController for why.
 */
@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role) private readonly roles: Repository<Role>,
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
}
