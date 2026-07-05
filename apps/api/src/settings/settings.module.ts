import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  Put,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from '@bnp/shared';
import {
  AuthenticatedUser,
  CurrentUser,
  Permissions,
} from '../common/decorators';
import { Setting } from '../entities';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(Setting) private readonly settings: Repository<Setting>,
    private readonly audit: AuditService,
  ) {}

  findAll() {
    return this.settings.find({ order: { key: 'ASC' } });
  }

  async upsert(key: string, value: unknown, actor: AuthenticatedUser) {
    const existing = await this.settings.findOne({ where: { key } });
    const saved = await this.settings.save(
      this.settings.create({
        key,
        value,
        description: existing?.description ?? null,
        updatedById: actor.userId,
      }),
    );
    this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'SETTINGS:UPDATE',
      resourceType: 'setting',
      resourceId: key,
      metadata: { from: existing?.value ?? null, to: value },
    });
    return saved;
  }
}

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @Permissions(Permission.SETTINGS_READ)
  findAll() {
    return this.settings.findAll();
  }

  @Put(':key')
  @Permissions(Permission.SETTINGS_MANAGE)
  upsert(
    @Param('key') key: string,
    @Body() body: { value: unknown },
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.settings.upsert(key, body.value, actor);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Setting])],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
