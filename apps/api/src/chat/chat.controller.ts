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
  ScreenForPhi,
} from '../common/decorators';
import { ChatService } from './chat.service';
import { PAGE_INT } from '../common/pagination';

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
  // The field this whole control exists for: free text a nurse types at the
  // bedside, persisted verbatim to ai_questions.question.
  @ScreenForPhi({ body: ['question'] })
  ask(@Body() dto: AskDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.chat.ask(dto, actor);
  }

  @Get('history')
  @Permissions(Permission.AI_ASK)
  history(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('limit', PAGE_INT) limit?: number,
  ) {
    return this.chat.history(actor, limit);
  }

  @Get('answers')
  @Permissions(Permission.AI_REVIEW_ANSWERS)
  listAnswersForReview(
    @Query('reviewStatus') reviewStatus?: string,
    @Query('limit', PAGE_INT) limit?: number,
    @Query('offset', PAGE_INT) offset?: number,
  ) {
    return this.chat.listAnswersForReview({ reviewStatus, limit, offset });
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
