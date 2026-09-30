import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateServerDto, UpdateServerDto, EnvVarDto } from '../servers/dto';

export { EnvVarDto };

// ---- query params (all optional; numbers arrive as strings) -------------------

export class AdminUserListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsIn(['user', 'admin']) role?: 'user' | 'admin';
  @IsOptional() @IsIn(['createdAt', 'name', 'email', 'planId']) sortBy?: 'createdAt' | 'name' | 'email' | 'planId';
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder?: 'asc' | 'desc';
}

export class AdminServerListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() @MaxLength(32) status?: string;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsIn(['createdAt', 'name', 'status', 'runtime']) sortBy?: 'createdAt' | 'name' | 'status' | 'runtime';
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder?: 'asc' | 'desc';
}

export class AdminAuditQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 50;
  @IsOptional() @IsString() @MaxLength(100) action?: string;
  @IsOptional() @IsUUID() actorId?: string;
  @IsOptional() @IsString() @MaxLength(32) targetType?: string;
  @IsOptional() @IsUUID() targetId?: string;
}

// ---- bodies -------------------------------------------------------------------

export class UpdateRoleDto {
  @IsIn(['user', 'admin'])
  role!: 'user' | 'admin';
}

export class UpdateUserPlanDto {
  @IsString() @MinLength(1) @MaxLength(32)
  planId!: string;
}

/** Aligned with the real `plans` table (priceCents/storageGb, not priceMonthly/maxStorageGb). */
export class CreatePlanDto {
  @Matches(/^[a-z0-9-]{2,32}$/, { message: 'plan id must be 2-32 lowercase letters/digits/dashes' })
  id!: string;

  @MinLength(2) @MaxLength(64)
  name!: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) priceCents?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(64000) cpuMilli?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(16) @Max(524288) ramMb?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10240) storageGb?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(500) maxServers?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) maxBackupSlots?: number;
}

export class UpdatePlanDto {
  @IsOptional() @MinLength(2) @MaxLength(64) name?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) priceCents?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(64000) cpuMilli?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(16) @Max(524288) ramMb?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10240) storageGb?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(500) maxServers?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) maxBackupSlots?: number;
}

/** Admin creates a server ON BEHALF of a user — owner is required and explicit. */
export class AdminCreateServerDto extends CreateServerDto {
  @IsUUID('4', { message: 'ownerId must be a valid user id' })
  ownerId!: string;
}

export class AdminUpdateServerDto extends UpdateServerDto {}

export type { CreateServerDto, UpdateServerDto };
