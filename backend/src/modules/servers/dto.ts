import { IsArray, IsBoolean, IsIn, IsOptional, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export const RUNTIMES = ['Node.js', 'Python', 'Bun', 'PHP'] as const;

export class EnvVarDto {
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[A-Z_][A-Z0-9_]*$/i, { message: 'env key invalid' })
  k!: string;

  @MaxLength(5000)
  v!: string;
}

export class CreateServerDto {
  @Matches(/^[a-z0-9-]{3,32}$/, { message: 'name must be 3-32 lowercase letters/digits/dashes' })
  name!: string;

  @IsIn(RUNTIMES as unknown as string[])
  runtime!: (typeof RUNTIMES)[number];

  @IsOptional()
  @MaxLength(32)
  region?: string = 'fra-de';

  @IsOptional()
  @MaxLength(32)
  planId?: string = 'free';

  @MinLength(1)
  @MaxLength(500)
  startup!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EnvVarDto)
  env?: EnvVarDto[];
}

export class UpdateServerDto {
  @IsOptional()
  @Matches(/^[a-z0-9-]{3,32}$/)
  name?: string;

  @IsOptional()
  @MaxLength(500)
  startup?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EnvVarDto)
  env?: EnvVarDto[];

  @IsOptional() @IsBoolean() autoRestart?: boolean;
  @IsOptional() @IsBoolean() autoBackup?: boolean;
}
