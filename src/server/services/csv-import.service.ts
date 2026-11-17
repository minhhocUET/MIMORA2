import { getServerConfig, type ServerConfig } from '../config/env.ts';
import { generateUuidV7 } from '../db/uuid.ts';
import { ApiErrors, isDatabaseError } from '../http/errors.ts';
import {
  createCsvImportRepository,
  type CsvImportJobRecord,
  type CsvImportRepository,
} from '../repositories/csv-import.repository.ts';
import { hashPassword, validatePasswordInput } from '../security/password-hash.ts';
import { ScryptConcurrencyLimiter } from '../security/scrypt-limiter.ts';
import { recordAuditEvent, type AuditActorRole, type AuditInsertExecutor } from './audit.service.ts';
import { normalizeEmail, normalizeUsername, USERNAME_REGEX } from './membership.service.ts';

const REQUIRED_CSV_HEADERS = ['org_username', 'display_name'] as const;
const SUPPORTED_CSV_HEADERS = new Set([
  'org_username',
  'display_name',
  'email',
  'initial_password',
]);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ParsedCsvDocument {
  headers: string[];
  rows: Array<{ rowNumber: number; fields: string[] }>;
}

/**
 * Memory-only RFC-4180 compliant CSV parser supporting UTF-8 BOM, CRLF/LF,
 * quoted commas, quoted newlines, and escaped double quotes ("").
 */
export function parseCsvDocument(rawInput: string): ParsedCsvDocument {
  const input = rawInput.startsWith('\uFEFF') ? rawInput.slice(1) : rawInput;
  const records: Array<{ rowNumber: number; fields: string[] }> = [];

  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let fieldStarted = false;
  let rowStartLine = 1;
  let currentLine = 1;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < input.length && input[i + 1] === '"') {
          currentField += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') {
          currentLine += 1;
        }
        currentField += ch;
      }
      continue;
    }

    if (ch === '"') {
      if (fieldStarted && currentField.length > 0) {
        throw ApiErrors.validation([
          {
            field: 'body.csvContent',
            code: 'MALFORMED_CSV_QUOTE',
            messageKey: 'error.csv.malformed_quote',
            message: `Dấu ngoặc kép không hợp lệ tại dòng ${rowStartLine}.`,
          },
        ]);
      }
      inQuotes = true;
      fieldStarted = true;
      continue;
    }

    if (ch === ',') {
      currentRow.push(currentField);
      currentField = '';
      fieldStarted = false;
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && i + 1 < input.length && input[i + 1] === '\n') {
        i += 1;
      }
      currentRow.push(currentField);
      const isBlankLine =
        currentRow.length === 1 && currentRow[0].trim().length === 0;
      if (!isBlankLine) {
        records.push({ rowNumber: rowStartLine, fields: currentRow });
      }
      currentLine += 1;
      rowStartLine = currentLine;
      currentRow = [];
      currentField = '';
      fieldStarted = false;
      continue;
    }

    fieldStarted = true;
    currentField += ch;
  }

  if (inQuotes) {
    throw ApiErrors.validation([
      {
        field: 'body.csvContent',
        code: 'UNCLOSED_CSV_QUOTE',
        messageKey: 'error.csv.unclosed_quote',
        message: 'Tệp CSV chứa dấu ngoặc kép chưa được đóng.',
      },
    ]);
  }

  if (fieldStarted || currentRow.length > 0) {
    currentRow.push(currentField);
    const isBlankLine =
      currentRow.length === 1 && currentRow[0].trim().length === 0;
    if (!isBlankLine) {
      records.push({ rowNumber: rowStartLine, fields: currentRow });
    }
  }

  if (records.length === 0) {
    throw ApiErrors.validation([
      {
        field: 'body.csvContent',
        code: 'EMPTY_CSV',
        messageKey: 'error.csv.empty',
        message: 'Tệp CSV trống hoặc không có dòng tiêu đề.',
      },
    ]);
  }

  const headers = records[0].fields.map((h) => h.trim().toLowerCase());
  const dataRows = records.slice(1);
  return { headers, rows: dataRows };
}

export interface SafeCsvRowError {
  rowNumber: number;
  orgUsername: string | null;
  code: string;
  message: string;
}

export interface SafeCsvPreviewRow {
  rowNumber: number;
  orgUsername: string;
  displayName: string;
  hasEmail: boolean;
  hasInitialPassword: boolean;
}

export interface CsvImportJobView {
  id: string;
  organizationId: string;
  uploadedByUserId: string;
  targetClassId: string | null;
  sourceFilename: string;
  status: string;
  totalRows: number;
  succeededRows: number;
  failedRows: number;
  errorSummaryJson: Record<string, unknown> | Array<Record<string, unknown>> | null;
  createdAt: string;
  completedAt: string | null;
}

function toSafeJobView(job: CsvImportJobRecord): CsvImportJobView {
  return {
    id: job.id,
    organizationId: job.organizationId,
    uploadedByUserId: job.uploadedByUserId,
    targetClassId: job.targetClassId,
    sourceFilename: job.sourceFilename,
    status: job.status,
    totalRows: job.totalRows,
    succeededRows: job.succeededRows,
    failedRows: job.failedRows,
    errorSummaryJson: job.errorSummaryJson,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
  };
}

export interface CsvActorContext {
  actorUserId: string;
  actorRole: AuditActorRole;
  teacherMembershipId: string | null;
  ipPrefix: string | null;
}

export interface CsvImportServiceDeps {
  repo?: CsvImportRepository;
  scryptLimiter?: ScryptConcurrencyLimiter;
  getConfig?: () => ServerConfig;
  now?: () => Date;
  hashPasswordFn?: typeof hashPassword;
  auditFn?: (
    input: Parameters<typeof recordAuditEvent>[0],
    executor?: AuditInsertExecutor
  ) => Promise<unknown>;
}

export function createCsvImportService(deps?: CsvImportServiceDeps) {
  const repo = deps?.repo ?? createCsvImportRepository();
  const getConfig = deps?.getConfig ?? getServerConfig;
  const scryptLimiter =
    deps?.scryptLimiter ??
    new ScryptConcurrencyLimiter({
      maxConcurrent: getConfig().auth.scryptMaxConcurrent,
      maxQueue: getConfig().auth.scryptMaxQueue,
    });
  const nowFn = deps?.now ?? (() => new Date());
  const hashPwd = deps?.hashPasswordFn ?? hashPassword;
  const emitAudit = deps?.auditFn ?? recordAuditEvent;

  async function safeAudit(input: Parameters<typeof recordAuditEvent>[0]): Promise<void> {
    await emitAudit(input);
  }

  function sanitizeFilename(raw: string): string {
    const base = raw.trim().split(/[/\\]/).pop() ?? 'import.csv';
    const cleaned = base.replace(/[^\w.\- ]+/g, '_').slice(0, 255);
    return cleaned || 'import.csv';
  }

  return {
    async listImportJobs(params: {
      organizationId: string;
      page: number;
      limit: number;
    }) {
      const org = await repo.findOrganizationById(params.organizationId);
      if (!org) {
        throw ApiErrors.notFound('Không tìm thấy tổ chức.');
      }
      const res = await repo.listImportJobsInOrg(params);
      return {
        items: res.items.map(toSafeJobView),
        page: params.page,
        limit: params.limit,
        total: res.total,
      };
    },

    async getImportJob(
      organizationId: string,
      jobId: string,
      actor: CsvActorContext
    ): Promise<CsvImportJobView> {
      const job = await repo.findImportJobById(organizationId, jobId);
      if (!job) {
        throw ApiErrors.notFound('Không tìm thấy tác vụ nhập CSV.');
      }
      if (actor.actorRole === 'teacher') {
        if (
          !job.targetClassId ||
          !actor.teacherMembershipId ||
          !(await repo.isTeacherAssignedToClass(
            organizationId,
            job.targetClassId,
            actor.teacherMembershipId
          ))
        ) {
          throw ApiErrors.forbidden('Bạn không có quyền xem tác vụ nhập CSV này.');
        }
      }
      return toSafeJobView(job);
    },

    async processStudentCsvImport(
      input: {
        organizationId: string;
        targetClassId?: string | null;
        sourceFilename: string;
        csvContent: string;
        mode?: 'preview' | 'commit';
      },
      actor: CsvActorContext
    ) {
      const config = getConfig();
      const mode = input.mode ?? 'preview';
      const targetClassId = input.targetClassId ?? null;
      const sourceFilename = sanitizeFilename(input.sourceFilename);

      const byteLength = Buffer.byteLength(input.csvContent, 'utf8');
      if (byteLength === 0 || byteLength > config.csv.maxBytes) {
        throw ApiErrors.validation([
          {
            field: 'body.csvContent',
            code: 'CSV_SIZE_EXCEEDED',
            messageKey: 'error.csv.size_exceeded',
            message: `Dung lượng nội dung CSV phải nằm trong khoảng 1..${config.csv.maxBytes} bytes.`,
          },
        ]);
      }

      // 1. Authorization & tenant/class checks BEFORE parsing or persisting anything
      const org = await repo.findOrganizationById(input.organizationId);
      if (!org) {
        throw ApiErrors.notFound('Không tìm thấy tổ chức.');
      }
      if (org.status !== 'active') {
        throw ApiErrors.conflict(
          'ORGANIZATION_NOT_ACTIVE',
          'error.org.not_active',
          'Tổ chức đang tạm ngưng, không thể nhập danh sách học sinh.'
        );
      }

      if (actor.actorRole === 'teacher') {
        if (!targetClassId || !actor.teacherMembershipId) {
          throw ApiErrors.forbidden(
            'Giáo viên chỉ được nhập CSV học sinh vào lớp học mình được phân công.'
          );
        }
        const cls = await repo.findClassInOrg(org.id, targetClassId);
        if (!cls) {
          await safeAudit({
            organizationId: org.id,
            actorUserId: actor.actorUserId,
            actorRole: 'teacher',
            eventType: 'security.cross_tenant_attempt_blocked',
            targetType: 'class',
            targetId: targetClassId,
            ipPrefix: actor.ipPrefix,
            metadata: { action: 'csv_import_class_not_in_org' },
          }).catch(() => undefined);
          throw ApiErrors.forbidden('Bạn không có quyền truy cập lớp học này.');
        }
        const assigned = await repo.isTeacherAssignedToClass(
          org.id,
          cls.id,
          actor.teacherMembershipId
        );
        if (!assigned) {
          await safeAudit({
            organizationId: org.id,
            actorUserId: actor.actorUserId,
            actorRole: 'teacher',
            eventType: 'security.unauthorized_access_denied',
            targetType: 'class',
            targetId: cls.id,
            ipPrefix: actor.ipPrefix,
            metadata: { action: 'csv_import_unassigned_class' },
          }).catch(() => undefined);
          throw ApiErrors.forbidden('Bạn không được phân công phụ trách lớp học này.');
        }
        if (cls.status !== 'active') {
          throw ApiErrors.conflict(
            'CLASS_NOT_ACTIVE',
            'error.class.not_active',
            'Lớp học không ở trạng thái hoạt động.'
          );
        }
      } else if (targetClassId) {
        const cls = await repo.findClassInOrg(org.id, targetClassId);
        if (!cls) {
          throw ApiErrors.notFound('Không tìm thấy lớp học đích trong tổ chức.');
        }
        if (cls.status !== 'active') {
          throw ApiErrors.conflict(
            'CLASS_NOT_ACTIVE',
            'error.class.not_active',
            'Lớp học không ở trạng thái hoạt động.'
          );
        }
      }

      // 2. Parse & header validation
      const parsed = parseCsvDocument(input.csvContent);
      if (parsed.rows.length === 0 || parsed.rows.length > config.csv.maxRows) {
        throw ApiErrors.validation([
          {
            field: 'body.csvContent',
            code: 'CSV_ROW_COUNT_INVALID',
            messageKey: 'error.csv.row_count_invalid',
            message: `Số dòng dữ liệu CSV phải nằm trong khoảng 1..${config.csv.maxRows} dòng.`,
          },
        ]);
      }

      const headerSet = new Set<string>();
      for (const h of parsed.headers) {
        if (!h || headerSet.has(h) || !SUPPORTED_CSV_HEADERS.has(h)) {
          throw ApiErrors.validation([
            {
              field: 'body.csvContent',
              code: 'INVALID_CSV_HEADERS',
              messageKey: 'error.csv.invalid_headers',
              message:
                'Tiêu đề cột CSV không hợp lệ hoặc bị trùng. Chỉ hỗ trợ: org_username, display_name, email, initial_password.',
            },
          ]);
        }
        headerSet.add(h);
      }

      for (const reqHeader of REQUIRED_CSV_HEADERS) {
        if (!headerSet.has(reqHeader)) {
          throw ApiErrors.validation([
            {
              field: 'body.csvContent',
              code: 'MISSING_CSV_HEADER',
              messageKey: 'error.csv.missing_header',
              message: `Thiếu cột bắt buộc trong CSV: ${reqHeader}.`,
            },
          ]);
        }
      }

      const idxUsername = parsed.headers.indexOf('org_username');
      const idxDisplayName = parsed.headers.indexOf('display_name');
      const idxEmail = parsed.headers.indexOf('email');
      const idxPassword = parsed.headers.indexOf('initial_password');

      // 3. Per-row normalization & in-file duplicate check
      const rowErrors: SafeCsvRowError[] = [];
      const candidateRows: Array<{
        rowNumber: number;
        orgUsername: string;
        displayName: string;
        email: string | null;
        initialPassword: string | null;
      }> = [];

      const seenUsernames = new Set<string>();
      const seenEmails = new Set<string>();

      for (const rawRow of parsed.rows) {
        if (rawRow.fields.length !== parsed.headers.length) {
          rowErrors.push({
            rowNumber: rawRow.rowNumber,
            orgUsername: null,
            code: 'COLUMN_COUNT_MISMATCH',
            message: 'Số lượng cột trong dòng không khớp tiêu đề CSV.',
          });
          continue;
        }

        const rawUsername = rawRow.fields[idxUsername] ?? '';
        const orgUsername = normalizeUsername(rawUsername);
        const displayName = (rawRow.fields[idxDisplayName] ?? '').trim();
        const rawEmail = idxEmail >= 0 ? (rawRow.fields[idxEmail] ?? '').trim() : '';
        const email = rawEmail.length > 0 ? normalizeEmail(rawEmail) : null;
        const rawPassword = idxPassword >= 0 ? (rawRow.fields[idxPassword] ?? '') : '';
        const initialPassword = rawPassword.length > 0 ? rawPassword : null;

        if (!orgUsername || orgUsername.includes('@') || !USERNAME_REGEX.test(orgUsername)) {
          rowErrors.push({
            rowNumber: rawRow.rowNumber,
            orgUsername: orgUsername || null,
            code: 'INVALID_ORG_USERNAME',
            message: 'org_username không hợp lệ (2-64 ký tự chữ thường/số/._-, không chứa @).',
          });
          continue;
        }

        if (displayName.length === 0 || displayName.length > 255) {
          rowErrors.push({
            rowNumber: rawRow.rowNumber,
            orgUsername,
            code: 'INVALID_DISPLAY_NAME',
            message: 'display_name là bắt buộc và tối đa 255 ký tự.',
          });
          continue;
        }

        if (email !== null && (!EMAIL_REGEX.test(email) || email.length > 255)) {
          rowErrors.push({
            rowNumber: rawRow.rowNumber,
            orgUsername,
            code: 'INVALID_EMAIL',
            message: 'email không đúng định dạng.',
          });
          continue;
        }

        if (initialPassword !== null) {
          try {
            validatePasswordInput(initialPassword);
          } catch {
            rowErrors.push({
              rowNumber: rawRow.rowNumber,
              orgUsername,
              code: 'INVALID_INITIAL_PASSWORD',
              message: 'Mật khẩu khởi tạo vượt quá độ dài tối đa cho phép hoặc rỗng.',
            });
            continue;
          }
        }

        if (seenUsernames.has(orgUsername)) {
          rowErrors.push({
            rowNumber: rawRow.rowNumber,
            orgUsername,
            code: 'DUPLICATE_IN_FILE_USERNAME',
            message: 'Trùng org_username trong cùng tệp CSV.',
          });
          continue;
        }
        seenUsernames.add(orgUsername);

        if (email !== null) {
          if (seenEmails.has(email)) {
            rowErrors.push({
              rowNumber: rawRow.rowNumber,
              orgUsername,
              code: 'DUPLICATE_IN_FILE_EMAIL',
              message: 'Trùng email trong cùng tệp CSV.',
            });
            continue;
          }
          seenEmails.add(email);
        }

        candidateRows.push({
          rowNumber: rawRow.rowNumber,
          orgUsername,
          displayName,
          email,
          initialPassword,
        });
      }

      // 4. Batch DB uniqueness check against organization & users
      const [existingUsernames, existingEmails] = await Promise.all([
        repo.findExistingOrgUsernames(
          org.id,
          candidateRows.map((r) => r.orgUsername)
        ),
        repo.findExistingEmails(
          candidateRows
            .map((r) => r.email)
            .filter((e): e is string => e !== null)
        ),
      ]);

      const readyRows: typeof candidateRows = [];
      for (const row of candidateRows) {
        if (existingUsernames.has(row.orgUsername)) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            orgUsername: row.orgUsername,
            code: 'ORG_USERNAME_EXISTS',
            message: 'org_username đã tồn tại trong tổ chức.',
          });
          continue;
        }
        if (row.email !== null && existingEmails.has(row.email)) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            orgUsername: row.orgUsername,
            code: 'EMAIL_ALREADY_EXISTS',
            message: 'email đã tồn tại trong hệ thống.',
          });
          continue;
        }
        readyRows.push(row);
      }

      const jobId = generateUuidV7();
      const startedAt = nowFn();

      await safeAudit({
        organizationId: org.id,
        actorUserId: actor.actorUserId,
        actorRole: actor.actorRole,
        eventType: 'account.csv_import_started',
        targetType: 'csv_import_job',
        targetId: jobId,
        ipPrefix: actor.ipPrefix,
        metadata: {
          mode,
          totalRows: parsed.rows.length,
          hasTargetClass: targetClassId !== null,
        },
      }).catch(() => undefined);

      // 5. Preview mode: record 'validated' job without creating accounts
      if (mode === 'preview') {
        const missingPasswordRows = readyRows.filter(
          (r) => r.initialPassword === null
        ).length;

        const errorSummaryJson = {
          mode: 'preview',
          errors: rowErrors,
          missingInitialPasswordRows: missingPasswordRows,
          credentialProvisioningPolicyStatus:
            missingPasswordRows > 0 ? 'DEFERRED_TO_PO' : 'EXPLICIT_INITIAL_PASSWORD',
        };

        const job = await repo.createImportJob({
          id: jobId,
          organizationId: org.id,
          uploadedByUserId: actor.actorUserId,
          targetClassId,
          sourceFilename,
          status: 'validated',
          totalRows: parsed.rows.length,
          succeededRows: readyRows.length,
          failedRows: rowErrors.length,
          errorSummaryJson,
          createdAt: startedAt,
          completedAt: nowFn(),
        });

        await safeAudit({
          organizationId: org.id,
          actorUserId: actor.actorUserId,
          actorRole: actor.actorRole,
          eventType: 'account.csv_import_completed',
          targetType: 'csv_import_job',
          targetId: jobId,
          ipPrefix: actor.ipPrefix,
          metadata: {
            mode: 'preview',
            status: job.status,
            totalRows: job.totalRows,
            validRows: readyRows.length,
            failedRows: rowErrors.length,
          },
        }).catch(() => undefined);

        const previewRows: SafeCsvPreviewRow[] = readyRows.map((r) => ({
          rowNumber: r.rowNumber,
          orgUsername: r.orgUsername,
          displayName: r.displayName,
          hasEmail: r.email !== null,
          hasInitialPassword: r.initialPassword !== null,
        }));

        return {
          job: toSafeJobView(job),
          previewRows,
          errors: rowErrors,
          credentialProvisioningPolicy:
            missingPasswordRows > 0
              ? 'DEFERRED_TO_PO_MISSING_DISTRIBUTION_AND_PIN_POLICY'
              : 'EXPLICIT_INITIAL_PASSWORD_PROVIDED',
        };
      }

      // 6. Commit mode: persist job row as 'pending', process each valid row atomically
      await repo.createImportJob({
        id: jobId,
        organizationId: org.id,
        uploadedByUserId: actor.actorUserId,
        targetClassId,
        sourceFilename,
        status: 'pending',
        totalRows: parsed.rows.length,
        succeededRows: 0,
        failedRows: 0,
        errorSummaryJson: null,
        createdAt: startedAt,
        completedAt: null,
      });

      let succeededCount = 0;
      const createdStudentIds: Array<{
        rowNumber: number;
        userId: string;
        membershipId: string;
        orgUsername: string;
      }> = [];

      for (const row of readyRows) {
        if (!row.initialPassword) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            orgUsername: row.orgUsername,
            code: 'INITIAL_PASSWORD_POLICY_REQUIRED',
            message:
              'Chưa có chính sách cấp phát/phân phối mật khẩu học sinh từ Product Owner; cần cung cấp initial_password rõ ràng hoặc dùng chế độ preview.',
          });
          continue;
        }

        const passwordHash = await scryptLimiter.run(() =>
          hashPwd(row.initialPassword!)
        );
        const rowNow = nowFn();
        const userId = generateUuidV7();
        const membershipId = generateUuidV7();
        const enrollmentId = targetClassId ? generateUuidV7() : null;

        try {
          await repo.withTransaction(async (tx) => {
            await repo.createImportedStudent(
              {
                userId,
                membershipId,
                enrollmentId,
                organizationId: org.id,
                targetClassId,
                orgUsername: row.orgUsername,
                displayName: row.displayName,
                email: row.email,
                passwordHash,
                createdByUserId: actor.actorUserId,
                now: rowNow,
              },
              tx
            );
          });
          succeededCount += 1;
          createdStudentIds.push({
            rowNumber: row.rowNumber,
            userId,
            membershipId,
            orgUsername: row.orgUsername,
          });
        } catch (err: unknown) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            orgUsername: row.orgUsername,
            code: isDatabaseError(err) ? 'ROW_CONFLICT' : 'ROW_IMPORT_FAILED',
            message: 'Không thể tạo tài khoản học sinh cho dòng này do xung đột dữ liệu.',
          });
        }
      }

      rowErrors.sort((a, b) => a.rowNumber - b.rowNumber);
      const finalStatus = succeededCount > 0 ? 'completed' : 'failed';
      const completedAt = nowFn();
      const finalSummary = {
        mode: 'commit',
        errors: rowErrors,
      };

      await repo.updateImportJob({
        id: jobId,
        organizationId: org.id,
        status: finalStatus,
        totalRows: parsed.rows.length,
        succeededRows: succeededCount,
        failedRows: rowErrors.length,
        errorSummaryJson: finalSummary,
        completedAt,
      });

      await safeAudit({
        organizationId: org.id,
        actorUserId: actor.actorUserId,
        actorRole: actor.actorRole,
        eventType:
          finalStatus === 'completed'
            ? 'account.csv_import_completed'
            : 'account.csv_import_failed',
        targetType: 'csv_import_job',
        targetId: jobId,
        ipPrefix: actor.ipPrefix,
        metadata: {
          mode: 'commit',
          status: finalStatus,
          totalRows: parsed.rows.length,
          succeededRows: succeededCount,
          failedRows: rowErrors.length,
        },
      }).catch(() => undefined);

      return {
        job: {
          id: jobId,
          organizationId: org.id,
          uploadedByUserId: actor.actorUserId,
          targetClassId,
          sourceFilename,
          status: finalStatus,
          totalRows: parsed.rows.length,
          succeededRows: succeededCount,
          failedRows: rowErrors.length,
          errorSummaryJson: finalSummary,
          createdAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
        },
        createdStudents: createdStudentIds,
        errors: rowErrors,
      };
    },
  };
}

export type CsvImportService = ReturnType<typeof createCsvImportService>;
