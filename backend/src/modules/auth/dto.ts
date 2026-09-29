import { IsEmail, Matches, MaxLength, MinLength } from 'class-validator';

export const MAX_PASSWORD_LEN = 128;

export class SignupDto {
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[^\s<>{}]+(?: [^\s<>{}]+)*$/, { message: 'name contains invalid characters' })
  name!: string;

  @IsEmail({}, { message: 'EMAIL_INVALID' })
  @MaxLength(255)
  email!: string;

  @MinLength(8, { message: 'PASSWORD_TOO_SHORT' })
  @MaxLength(MAX_PASSWORD_LEN, { message: 'PASSWORD_TOO_LONG' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'PASSWORD_TOO_SIMPLE' })
  password!: string;
}

export class LoginDto {
  @IsEmail({}, { message: 'EMAIL_INVALID' })
  @MaxLength(255)
  email!: string;

  @MinLength(1)
  @MaxLength(MAX_PASSWORD_LEN)
  password!: string;
}
