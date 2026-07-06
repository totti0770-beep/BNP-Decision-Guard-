import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Role, User } from '../entities';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/decorators';

export interface CreateUserInput {
  email: string;
  password: string;
  fullName: string;
  roles: string[];
}

export interface UpdateUserInput {
  fullName?: string;
  password?: string;
  isActive?: boolean;
  roles?: string[];
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    private readonly audit: AuditService,
  ) {}

  private toDto(user: User) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      isActive: user.isActive,
      mfaEnabled: user.mfaEnabled,
      roles: user.roles?.map((r) => r.name) ?? [],
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    };
  }

  async findAll() {
    const users = await this.users.find({ order: { createdAt: 'ASC' } });
    return users.map((u) => this.toDto(u));
  }

  private async resolveRoles(names: string[]): Promise<Role[]> {
    const roles = await this.roles.find({ where: { name: In(names) } });
    if (roles.length !== names.length) {
      throw new BadRequestException('One or more roles do not exist');
    }
    return roles;
  }

  async create(input: CreateUserInput, actor: AuthenticatedUser) {
    const existing = await this.users.findOne({
      where: { email: input.email.toLowerCase() },
    });
    if (existing) throw new BadRequestException('Email already registered');

    const user = await this.users.save(
      this.users.create({
        email: input.email.toLowerCase(),
        fullName: input.fullName,
        passwordHash: await bcrypt.hash(input.password, 10),
        roles: await this.resolveRoles(input.roles),
      }),
    );
    this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'USERS:CREATE',
      resourceType: 'user',
      resourceId: user.id,
      metadata: { email: user.email, roles: input.roles },
    });
    return this.toDto(user);
  }

  async update(id: string, input: UpdateUserInput, actor: AuthenticatedUser) {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    const changes: Record<string, unknown> = {};
    if (input.fullName !== undefined) {
      changes.fullName = { from: user.fullName, to: input.fullName };
      user.fullName = input.fullName;
    }
    if (input.isActive !== undefined) {
      changes.isActive = { from: user.isActive, to: input.isActive };
      user.isActive = input.isActive;
    }
    if (input.password) {
      changes.password = 'rotated';
      user.passwordHash = await bcrypt.hash(input.password, 10);
      // Invalidate existing refresh tokens when the password changes.
      user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    }
    if (input.roles) {
      changes.roles = {
        from: user.roles.map((r) => r.name),
        to: input.roles,
      };
      user.roles = await this.resolveRoles(input.roles);
    }

    const saved = await this.users.save(user);
    this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: input.roles ? 'USERS:UPDATE_PERMISSIONS' : 'USERS:UPDATE',
      resourceType: 'user',
      resourceId: id,
      metadata: changes,
    });
    return this.toDto(saved);
  }

  /** Soft delete: deactivates the account so audit history stays intact. */
  async remove(id: string, actor: AuthenticatedUser) {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    user.isActive = false;
    await this.users.save(user);
    this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'USERS:DEACTIVATE',
      resourceType: 'user',
      resourceId: id,
      metadata: { email: user.email },
    });
    return { deactivated: true };
  }
}
