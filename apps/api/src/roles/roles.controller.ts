import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Permission } from '@bnp/shared';
import {
  AuthenticatedUser,
  CurrentUser,
  Permissions,
} from '../common/decorators';
import { RolesService } from './roles.service';

class CreateRoleDto {
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsString() description?: string;
  @IsArray() permissions: string[];
}

class UpdateRoleDto {
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() permissions?: string[];
}

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @Permissions(Permission.ROLES_READ)
  findAll() {
    return this.roles.findAll();
  }

  @Post()
  @Permissions(Permission.ROLES_MANAGE)
  create(@Body() dto: CreateRoleDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.roles.create(dto, actor);
  }

  @Patch(':id')
  @Permissions(Permission.ROLES_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.roles.update(id, dto, actor);
  }
}
