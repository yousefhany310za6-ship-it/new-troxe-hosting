import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Path params are always uuids here. Validating up front turns Postgres
 * `invalid input syntax for type uuid` 500s into a clean 404.
 */
@Injectable()
export class ParseUuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !UUID_RE.test(value)) {
      throw new BadRequestException({ statusCode: 404, code: 'NOT_FOUND', message: 'Resource not found' });
    }
    return value;
  }
}
