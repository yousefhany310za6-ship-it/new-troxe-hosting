import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class EmailSettingsDto {
  @IsBoolean()
  newLoginEmails!: boolean;
}

export class CampaignCreateDto {
  @IsString()
  @MaxLength(128)
  @Matches(/\S/, { message: 'name must not be blank' })
  name!: string;

  @IsString()
  @MaxLength(255)
  @Matches(/\S/, { message: 'subject must not be blank' })
  subject!: string;

  @IsString()
  @MaxLength(256 * 1024)
  html!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64 * 1024)
  text?: string;
}

export class CampaignUpdateDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256 * 1024)
  html?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64 * 1024)
  text?: string | null;
}

export class RecipientFiltersDto {
  @IsOptional()
  @IsIn(['all', 'verified', 'unverified'])
  audience?: 'all' | 'verified' | 'unverified';

  @IsOptional()
  @IsString()
  @MaxLength(32)
  planId?: string;

  @IsOptional()
  @IsIn(['user', 'admin'])
  role?: 'user' | 'admin';

  @IsOptional()
  @IsString()
  @MaxLength(128)
  search?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsUUID('4', { each: true })
  ids?: string[];
}

export class RecipientsQueryDto {
  @IsOptional()
  @IsIn(['pending', 'sending', 'sent', 'failed', 'skipped'])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  offset?: number;
}
