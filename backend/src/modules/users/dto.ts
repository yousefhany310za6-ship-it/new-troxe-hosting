import { IsBoolean, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Profile PATCH is username-only: email is immutable (accounts are keyed by
 * it) and avatars have dedicated upload/remove endpoints. `whitelist +
 * forbidNonWhitelisted` on the global ValidationPipe turns any attempt to
 * send `email` / `avatarUrl` here into a hard 400 — the restriction is
 * enforced server-side, not just hidden in the UI.
 */
export class UpdateProfileDto {
  @MinLength(3, { message: 'NAME_TOO_SHORT' })
  @MaxLength(30, { message: 'NAME_TOO_LONG' })
  @Matches(/^[\p{L}\p{N}._-]+(?: [\p{L}\p{N}._-]+)*$/u, {
    message: 'NAME_INVALID_CHARS',
  })
  name!: string;
}

export class UpdatePasswordDto {
  @MinLength(1)
  @MaxLength(128)
  current!: string;

  @IsOptional()
  @IsString()
  @Length(6, 12)
  twoFactorCode?: string;

  @MinLength(8, { message: 'PASSWORD_TOO_SHORT' })
  @MaxLength(128, { message: 'PASSWORD_TOO_LONG' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'PASSWORD_TOO_SIMPLE' })
  next!: string;

  @MinLength(8, { message: 'PASSWORD_TOO_SHORT' })
  @MaxLength(128, { message: 'PASSWORD_TOO_LONG' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'PASSWORD_TOO_SIMPLE' })
  confirm!: string;
}

export class UpdateNotificationsDto {
  @IsOptional() @IsBoolean() restarts?: boolean;
  @IsOptional() @IsBoolean() invoices?: boolean;
  @IsOptional() @IsBoolean() marketing?: boolean;
}

export class DeleteAccountDto {
  /** Destructive action: the current password must confirm it. */
  @MinLength(1)
  @MaxLength(128)
  current!: string;

  @IsOptional()
  @IsString()
  @Length(6, 12)
  twoFactorCode?: string;
}

export class SetPasswordDto {
  @MinLength(8, { message: 'PASSWORD_TOO_SHORT' })
  @MaxLength(128, { message: 'PASSWORD_TOO_LONG' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'PASSWORD_TOO_SIMPLE' })
  next!: string;

  @MinLength(8, { message: 'PASSWORD_TOO_SHORT' })
  @MaxLength(128, { message: 'PASSWORD_TOO_LONG' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'PASSWORD_TOO_SIMPLE' })
  confirm!: string;

  @IsOptional()
  @IsString()
  @Length(6, 12)
  twoFactorCode?: string;
}
