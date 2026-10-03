import { IsBoolean, IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[^\s<>{}]+(?: [^\s<>{}]+)*$/, { message: 'name contains invalid characters' })
  name!: string;

  @IsEmail({}, { message: 'EMAIL_INVALID' })
  @MaxLength(255)
  email!: string;

  /** Required when (and only when) the email address changes. */
  @IsOptional()
  @MaxLength(128)
  current?: string;

  /**
   * Avatar URL (https only, ≤2048 chars). Absent = unchanged; empty string =
   * clear. OAuth fills this only while it is null, so a manual value set here
   * is never overwritten by a later provider login.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  avatarUrl?: string;
}

export class UpdatePasswordDto {
  @MinLength(1)
  @MaxLength(128)
  current!: string;

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
}
