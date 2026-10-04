import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class VerifyCodeDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'VERIFY_INVALID' })
  code!: string;
}

export class PasswordResetRequestDto {
  @IsEmail({}, { message: 'EMAIL_INVALID' })
  @MaxLength(255)
  email!: string;
}

export class PasswordResetConfirmDto {
  @IsString()
  @MaxLength(512)
  token!: string;

  @MinLength(8, { message: 'PASSWORD_TOO_SHORT' })
  @MaxLength(128, { message: 'PASSWORD_TOO_LONG' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'PASSWORD_TOO_SIMPLE' })
  next!: string;

  @MinLength(8)
  @MaxLength(128)
  confirm!: string;
}
