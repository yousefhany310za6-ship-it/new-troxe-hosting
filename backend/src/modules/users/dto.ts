import { IsBoolean, IsEmail, IsOptional, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[^\s<>{}]+(?: [^\s<>{}]+)*$/, { message: 'name contains invalid characters' })
  name!: string;

  @IsEmail({}, { message: 'EMAIL_INVALID' })
  @MaxLength(255)
  email!: string;
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
