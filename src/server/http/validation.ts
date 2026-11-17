import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ApiErrors, type ApiErrorDetail, AppError } from './errors.ts';

export type ValidationTarget = 'body' | 'query' | 'params';

function mapZodIssueToDetail(
  issue: z.core.$ZodIssue,
  prefix?: ValidationTarget
): ApiErrorDetail {
  const pathStr = issue.path.length > 0 ? issue.path.map(String).join('.') : '_root';
  const field = prefix ? `${prefix}.${pathStr}` : pathStr;

  switch (issue.code) {
    case 'invalid_type': {
      const isMissing =
        'input' in issue ? issue.input === undefined : issue.message.toLowerCase().includes('received undefined');
      if (isMissing) {
        return {
          field,
          code: 'REQUIRED',
          messageKey: 'error.validation.required',
          message: 'Trường này là bắt buộc.',
        };
      }
      return {
        field,
        code: 'INVALID_TYPE',
        messageKey: 'error.validation.invalid_type',
        message: 'Kiểu dữ liệu không hợp lệ.',
      };
    }

    case 'too_small':
      return {
        field,
        code: 'TOO_SMALL',
        messageKey: 'error.validation.too_small',
        message: 'Giá trị hoặc độ dài nhỏ hơn mức tối thiểu cho phép.',
      };

    case 'too_big':
      return {
        field,
        code: 'TOO_BIG',
        messageKey: 'error.validation.too_big',
        message: 'Giá trị hoặc độ dài vượt quá mức tối đa cho phép.',
      };

    case 'invalid_value':
      return {
        field,
        code: 'INVALID_ENUM',
        messageKey: 'error.validation.invalid_choice',
        message: 'Giá trị không nằm trong danh sách được phép.',
      };

    case 'invalid_format':
      return {
        field,
        code: 'INVALID_FORMAT',
        messageKey: 'error.validation.invalid_format',
        message: 'Định dạng dữ liệu không hợp lệ.',
      };

    case 'unrecognized_keys':
      return {
        field,
        code: 'UNRECOGNIZED_KEYS',
        messageKey: 'error.validation.unrecognized_keys',
        message: 'Dữ liệu chứa trường không được hỗ trợ.',
      };

    default:
      return {
        field,
        code: 'INVALID_VALUE',
        messageKey: 'error.validation.invalid_field',
        message: 'Giá trị trường dữ liệu không hợp lệ.',
      };
  }
}

export function formatZodIssues(
  error: z.ZodError,
  prefix?: ValidationTarget
): ApiErrorDetail[] {
  return error.issues.map((issue) => mapZodIssueToDetail(issue, prefix));
}

export function validateWithSchema<T>(
  schema: z.ZodType<T>,
  input: unknown,
  target?: ValidationTarget
): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw ApiErrors.validation(formatZodIssues(result.error, target));
  }
  return result.data;
}

export interface RequestValidationSchemas<
  TParams = unknown,
  TQuery = unknown,
  TBody = unknown,
> {
  params?: z.ZodType<TParams>;
  query?: z.ZodType<TQuery>;
  body?: z.ZodType<TBody>;
}

export interface ValidatedRequestParts<TParams, TQuery, TBody> {
  params: TParams;
  query: TQuery;
  body: TBody;
}

export function validateRequest<
  TParams = unknown,
  TQuery = unknown,
  TBody = unknown,
>(
  req: Pick<Request, 'params' | 'query' | 'body'>,
  schemas: RequestValidationSchemas<TParams, TQuery, TBody>
): ValidatedRequestParts<TParams, TQuery, TBody> {
  const details: ApiErrorDetail[] = [];

  let parsedParams = req.params as TParams;
  let parsedQuery = req.query as TQuery;
  let parsedBody = req.body as TBody;

  if (schemas.params) {
    const res = schemas.params.safeParse(req.params);
    if (!res.success) {
      details.push(...formatZodIssues(res.error, 'params'));
    } else {
      parsedParams = res.data;
    }
  }

  if (schemas.query) {
    const res = schemas.query.safeParse(req.query);
    if (!res.success) {
      details.push(...formatZodIssues(res.error, 'query'));
    } else {
      parsedQuery = res.data;
    }
  }

  if (schemas.body) {
    const res = schemas.body.safeParse(req.body);
    if (!res.success) {
      details.push(...formatZodIssues(res.error, 'body'));
    } else {
      parsedBody = res.data;
    }
  }

  if (details.length > 0) {
    throw ApiErrors.validation(details);
  }

  return {
    params: parsedParams,
    query: parsedQuery,
    body: parsedBody,
  };
}

export function createValidationMiddleware<
  TParams = unknown,
  TQuery = unknown,
  TBody = unknown,
>(schemas: RequestValidationSchemas<TParams, TQuery, TBody>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.locals.validated = validateRequest(req, schemas);
      next();
    } catch (err: unknown) {
      if (err instanceof AppError) {
        next(err);
        return;
      }
      next(err);
    }
  };
}
