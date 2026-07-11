import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AssistantType, DocumentCategory, Permission } from '@bnp/shared';
import {
  AuthenticatedUser,
  CurrentUser,
  Permissions,
} from '../common/decorators';
import { ChatService } from './chat.service';

class AskDto {
  @IsString() @IsNotEmpty() question: string;
  @IsOptional() @IsEnum(AssistantType) assistantType?: AssistantType;
  @IsOptional() @IsEnum(DocumentCategory) category?: DocumentCategory;
  @IsOptional() @IsString() channel?: string;
}

class ReviewDto {
  @IsIn(['APPROVED', 'FLAGGED']) status: 'APPROVED' | 'FLAGGED';
}

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('ask')
  @Permissions(Permission.AI_ASK)
  ask(@Body() dto: AskDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.chat.ask(dto, actor);
  }

  @Get('history')
  @Permissions(Permission.AI_ASK)
  history(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('limit') limit?: string,
  ) {
    return this.chat.history(actor, limit ? parseInt(limit, 10) : undefined);
  }

  @Get('answers')
  @Permissions(Permission.AI_REVIEW_ANSWERS)
  listAnswersForReview(
    @Query('reviewStatus') reviewStatus?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.chat.listAnswersForReview({
      reviewStatus,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Post('answers/:id/review')
  @Permissions(Permission.AI_REVIEW_ANSWERS)
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.chat.reviewAnswer(id, dto.status, actor);
  }
}
