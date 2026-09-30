import { IsOptional, IsString, MaxLength } from 'class-validator';

export class FilesQuery {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  path?: string;
}

export class WriteFileDto {
  @IsString()
  @MaxLength(512)
  path!: string;

  /** UTF-8 text (service enforces the byte cap). */
  @IsOptional()
  @IsString()
  @MaxLength(1_000_000)
  content?: string;

  /** standard base64 (binary-safe upload without multipart). */
  @IsOptional()
  @IsString()
  @MaxLength(4_000_000)
  contentBase64?: string;
}

export class MkdirDto {
  @IsString()
  @MaxLength(512)
  path!: string;
}

export class RenameDto {
  @IsString()
  @MaxLength(512)
  from!: string;

  @IsString()
  @MaxLength(512)
  to!: string;
}
