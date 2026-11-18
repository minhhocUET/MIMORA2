import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Play, ShieldCheck, Upload } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { ApiClientError } from '../../api/client.ts';
import { resolveLocalizedErrorMessage, type AppLocale } from '../../i18n/index.ts';
import type { CsvImportJobView, CsvImportRunResponse } from '../../types/admin.ts';
import { CSV_STUDENT_TEMPLATE, formatDateTime } from '../../utils/p302.ts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Dialog,
  EmptyState,
  FormField,
  Input,
  Select,
  type SelectOption,
} from '../ui/index.ts';

export interface CsvImportPanelProps {
  locale: AppLocale;
  title: string;
  description: string;
  classOptions?: SelectOption[];
  selectedClassId?: string;
  onSelectClassId?: (classId: string) => void;
  allowOptionalClass?: boolean;
  onExecuteImport: (params: {
    mode: 'preview' | 'commit';
    sourceFilename: string;
    csvContent: string;
    targetClassId: string | null;
  }) => Promise<CsvImportRunResponse>;
  pastJobs?: CsvImportJobView[];
  loadingJobs?: boolean;
  onCommitted?: () => Promise<void> | void;
  onToast?: (msg: string) => void;
}

export function CsvImportPanel({
  locale,
  title,
  description,
  classOptions,
  selectedClassId = '',
  onSelectClassId,
  allowOptionalClass = false,
  onExecuteImport,
  pastJobs,
  loadingJobs = false,
  onCommitted,
  onToast,
}: CsvImportPanelProps) {
  const [sourceFilename, setSourceFilename] = useState('danh-sach-hoc-sinh.csv');
  const [csvContent, setCsvContent] = useState('');
  const [submittingMode, setSubmittingMode] = useState<'preview' | 'commit' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<CsvImportRunResponse | null>(null);
  const [commitResult, setCommitResult] = useState<CsvImportRunResponse | null>(null);
  const [confirmCommitOpen, setConfirmCommitOpen] = useState(false);

  const handleFilePick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    setSourceFilename(file.name);
    const text = await file.text();
    setCsvContent(text);
    setPreviewResult(null);
    setCommitResult(null);
    setErrorMsg(null);
  };

  const handleDownloadSample = () => {
    const blob = new Blob([CSV_STUDENT_TEMPLATE], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mimora-student-import-sample.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const runPreview = async () => {
    if (!csvContent.trim()) {
      setErrorMsg('Vui lòng chọn tệp CSV hoặc dán nội dung CSV trước khi kiểm tra.');
      return;
    }
    setSubmittingMode('preview');
    setErrorMsg(null);
    setCommitResult(null);
    try {
      const res = await onExecuteImport({
        mode: 'preview',
        sourceFilename: sourceFilename.trim() || 'import.csv',
        csvContent,
        targetClassId: selectedClassId ? selectedClassId : null,
      });
      setPreviewResult(res);
      onToast?.('Đã hoàn tất bước kiểm tra trước (Preview) tệp CSV.');
      await onCommitted?.();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrorMsg(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setErrorMsg('Không thể kiểm tra tệp CSV. Vui lòng thử lại.');
      }
    } finally {
      setSubmittingMode(null);
    }
  };

  const runCommit = async () => {
    setConfirmCommitOpen(false);
    setSubmittingMode('commit');
    setErrorMsg(null);
    try {
      const res = await onExecuteImport({
        mode: 'commit',
        sourceFilename: sourceFilename.trim() || 'import.csv',
        csvContent,
        targetClassId: selectedClassId ? selectedClassId : null,
      });
      setCommitResult(res);
      onToast?.(
        `Đã thực thi nhập CSV: tạo thành công ${res.createdStudents?.length ?? res.job.succeededRows} tài khoản học sinh.`
      );
      await onCommitted?.();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrorMsg(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setErrorMsg('Không thể thực thi nhập CSV. Vui lòng thử lại.');
      }
    } finally {
      setSubmittingMode(null);
    }
  };

  const activeResult = commitResult ?? previewResult;
  const readyRowsCount = previewResult?.previewRows?.length ?? 0;
  const hasMissingPasswordsInPreview =
    previewResult?.previewRows?.some((r) => !r.hasInitialPassword) ?? false;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={title}
          description={description}
          action={
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Download className="h-4 w-4" aria-hidden="true" />}
              onClick={handleDownloadSample}
            >
              Tải tệp mẫu CSV
            </Button>
          }
        />
        <CardContent className="space-y-5">
          <Alert variant="info" title="Cấu trúc cột CSV chuẩn của MIMORA">
            <div className="space-y-1.5 text-xs sm:text-sm">
              <p>
                Cột bắt buộc: <span className="font-mono font-semibold">org_username</span>,{' '}
                <span className="font-mono font-semibold">display_name</span>. Cột tùy chọn:{' '}
                <span className="font-mono font-semibold">email</span>,{' '}
                <span className="font-mono font-semibold">initial_password</span>.
              </p>
              <p className="text-[var(--mimora-muted)]">
                Bước <strong>Kiểm tra trước (Preview)</strong> chạy kiểm tra hợp lệ mà chưa tạo tài khoản.
                Để <strong>Xác nhận nhập thật (Commit)</strong>, mỗi dòng hợp lệ phải có sẵn{' '}
                <span className="font-mono">initial_password</span> (học sinh không dùng email bắt buộc).
              </p>
            </div>
          </Alert>

          {errorMsg && <Alert variant="danger">{errorMsg}</Alert>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Tên tệp hiển thị" htmlFor="csv-filename">
              <Input
                id="csv-filename"
                value={sourceFilename}
                onChange={(e) => setSourceFilename(e.target.value)}
                placeholder="danh-sach-lop-1a.csv"
              />
            </FormField>

            {classOptions && onSelectClassId && (
              <FormField
                label={allowOptionalClass ? 'Ghi danh vào lớp (tùy chọn)' : 'Lớp học đích'}
                htmlFor="csv-target-class"
              >
                <Select
                  id="csv-target-class"
                  value={selectedClassId}
                  onChange={(e) => {
                    onSelectClassId(e.target.value);
                    setPreviewResult(null);
                    setCommitResult(null);
                  }}
                  options={
                    allowOptionalClass
                      ? [{ value: '', label: 'Không ghi danh lớp cụ thể (chỉ vào trường)' }, ...classOptions]
                      : classOptions
                  }
                />
              </FormField>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 min-h-[42px] px-4 py-2 rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border-strong)] bg-[var(--mimora-surface)] hover:bg-[var(--mimora-surface-subtle)] text-sm font-medium cursor-pointer">
              <Upload className="h-4 w-4 text-[var(--mimora-primary)]" aria-hidden="true" />
              <span>Chọn tệp .csv từ máy</span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => void handleFilePick(e)}
                className="sr-only"
              />
            </label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSourceFilename('mimora-sample.csv');
                setCsvContent(CSV_STUDENT_TEMPLATE);
                setPreviewResult(null);
                setCommitResult(null);
                setErrorMsg(null);
              }}
            >
              Điền dữ liệu mẫu thử nghiệm
            </Button>
          </div>

          <FormField
            label="Nội dung CSV (UTF-8)"
            htmlFor="csv-raw-content"
            hint="Chỉnh sửa trực tiếp hoặc tải tệp lên. Hệ thống luôn chạy kiểm tra trước khi tạo tài khoản."
          >
            <textarea
              id="csv-raw-content"
              rows={7}
              value={csvContent}
              onChange={(e) => {
                setCsvContent(e.target.value);
                setPreviewResult(null);
                setCommitResult(null);
              }}
              placeholder={CSV_STUDENT_TEMPLATE}
              className="w-full rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border-strong)] bg-[var(--mimora-surface)] p-3 font-mono text-xs sm:text-sm text-[var(--mimora-text)] focus:border-[var(--mimora-primary)]"
            />
          </FormField>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              loading={submittingMode === 'preview'}
              disabled={submittingMode !== null || !csvContent.trim()}
              leftIcon={<FileSpreadsheet className="h-4 w-4" aria-hidden="true" />}
              onClick={() => void runPreview()}
            >
              1. Kiểm tra trước (Preview)
            </Button>

            <Button
              variant="primary"
              loading={submittingMode === 'commit'}
              disabled={
                submittingMode !== null ||
                !previewResult ||
                readyRowsCount === 0 ||
                Boolean(commitResult)
              }
              leftIcon={<Play className="h-4 w-4" aria-hidden="true" />}
              onClick={() => setConfirmCommitOpen(true)}
            >
              2. Xác nhận nhập thật (Commit {readyRowsCount > 0 ? `${readyRowsCount} dòng` : ''})
            </Button>
          </div>
        </CardContent>
      </Card>

      {activeResult && (
        <Card>
          <CardHeader
            title={
              commitResult
                ? 'Kết quả thực thi nhập CSV'
                : 'Kết quả kiểm tra trước (Preview — Chưa tạo tài khoản)'
            }
            description={`Mã tác vụ: ${activeResult.job.id} · Tổng dòng: ${activeResult.job.totalRows} · Hợp lệ/Thành công: ${activeResult.job.succeededRows} · Lỗi: ${activeResult.job.failedRows}`}
            action={
              <Badge variant={commitResult ? 'success' : 'info'}>
                {commitResult ? 'Đã thực thi (Commit)' : 'Bản xem trước (Validated)'}
              </Badge>
            }
          />
          <CardContent className="space-y-5">
            {previewResult && hasMissingPasswordsInPreview && !commitResult && (
              <Alert variant="warning" title="Thiếu cột initial_password trên một số dòng">
                Chế độ kiểm tra trước cho phép kiểm tra dữ liệu không cần mật khẩu, nhưng khi
                chạy Commit hệ thống sẽ bỏ qua các dòng không có{' '}
                <span className="font-mono">initial_password</span> với mã{' '}
                <span className="font-mono">INITIAL_PASSWORD_POLICY_REQUIRED</span>.
              </Alert>
            )}

            {commitResult?.createdStudents && commitResult.createdStudents.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-[var(--mimora-text)] flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[var(--mimora-success)]" aria-hidden="true" />
                  Tài khoản học sinh vừa tạo ({commitResult.createdStudents.length})
                </h3>
                <div className="overflow-x-auto rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)]">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead className="bg-[var(--mimora-surface-subtle)] text-xs text-[var(--mimora-muted)]">
                      <tr>
                        <th className="py-2.5 px-3 font-medium">Dòng</th>
                        <th className="py-2.5 px-3 font-medium">org_username</th>
                        <th className="py-2.5 px-3 font-medium">Mã User</th>
                        <th className="py-2.5 px-3 font-medium">Mã Thành viên (Membership)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--mimora-border)] tabular-nums">
                      {commitResult.createdStudents.map((st) => (
                        <tr key={st.membershipId}>
                          <td className="py-2 px-3">{st.rowNumber}</td>
                          <td className="py-2 px-3 font-mono text-xs">{st.orgUsername}</td>
                          <td className="py-2 px-3 font-mono text-xs text-[var(--mimora-muted)]">{st.userId}</td>
                          <td className="py-2 px-3 font-mono text-xs text-[var(--mimora-muted)]">{st.membershipId}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!commitResult && previewResult?.previewRows && previewResult.previewRows.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-[var(--mimora-text)] flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-[var(--mimora-primary)]" aria-hidden="true" />
                  Dòng hợp lệ sẵn sàng nhập ({previewResult.previewRows.length})
                </h3>
                <div className="overflow-x-auto rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)]">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead className="bg-[var(--mimora-surface-subtle)] text-xs text-[var(--mimora-muted)]">
                      <tr>
                        <th className="py-2.5 px-3 font-medium">Dòng</th>
                        <th className="py-2.5 px-3 font-medium">org_username</th>
                        <th className="py-2.5 px-3 font-medium">Tên hiển thị</th>
                        <th className="py-2.5 px-3 font-medium">Email</th>
                        <th className="py-2.5 px-3 font-medium">Mật khẩu khởi tạo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--mimora-border)] tabular-nums">
                      {previewResult.previewRows.map((row) => (
                        <tr key={`${row.rowNumber}-${row.orgUsername}`}>
                          <td className="py-2 px-3">{row.rowNumber}</td>
                          <td className="py-2 px-3 font-mono text-xs">{row.orgUsername}</td>
                          <td className="py-2 px-3">{row.displayName}</td>
                          <td className="py-2 px-3 text-xs text-[var(--mimora-muted)]">
                            {row.hasEmail ? 'Có cung cấp' : 'Không (tùy chọn)'}
                          </td>
                          <td className="py-2 px-3">
                            {row.hasInitialPassword ? (
                              <Badge variant="success">Sẵn sàng</Badge>
                            ) : (
                              <Badge variant="warning">Thiếu khi Commit</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeResult.errors.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-[var(--mimora-danger)] flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  Lỗi chi tiết theo từng dòng ({activeResult.errors.length})
                </h3>
                <div className="overflow-x-auto rounded-[var(--mimora-radius-md)] border border-[var(--mimora-danger-border)]">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead className="bg-[var(--mimora-danger-bg)] text-xs text-[var(--mimora-danger)]">
                      <tr>
                        <th className="py-2.5 px-3 font-medium">Dòng</th>
                        <th className="py-2.5 px-3 font-medium">org_username</th>
                        <th className="py-2.5 px-3 font-medium">Mã lỗi</th>
                        <th className="py-2.5 px-3 font-medium">Thông báo từ máy chủ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--mimora-danger-border)] tabular-nums">
                      {activeResult.errors.map((err, idx) => (
                        <tr key={`${err.rowNumber}-${err.code}-${idx}`}>
                          <td className="py-2 px-3">{err.rowNumber}</td>
                          <td className="py-2 px-3 font-mono text-xs">{err.orgUsername ?? '—'}</td>
                          <td className="py-2 px-3 font-mono text-xs">{err.code}</td>
                          <td className="py-2 px-3">{err.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {pastJobs !== undefined && (
        <Card>
          <CardHeader
            title="Lịch sử tác vụ nhập CSV gần đây"
            description="Chỉ hiển thị tệp, số lượng dòng và trạng thái do máy chủ ghi nhận."
          />
          <CardContent>
            {loadingJobs ? (
              <p className="text-sm text-[var(--mimora-muted)]">Đang tải lịch sử nhập CSV...</p>
            ) : pastJobs.length === 0 ? (
              <EmptyState
                title="Chưa có lịch sử nhập CSV trong trường này"
                description="Khi chạy kiểm tra trước hoặc nhập thật tệp CSV, bản ghi tác vụ sẽ xuất hiện tại đây."
              />
            ) : (
              <div className="overflow-x-auto rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)]">
                <table className="w-full text-left text-sm border-collapse">
                  <thead className="bg-[var(--mimora-surface-subtle)] text-xs text-[var(--mimora-muted)]">
                    <tr>
                      <th className="py-2.5 px-3 font-medium">Tệp nguồn</th>
                      <th className="py-2.5 px-3 font-medium">Trạng thái</th>
                      <th className="py-2.5 px-3 font-medium">Tổng / Đạt / Lỗi</th>
                      <th className="py-2.5 px-3 font-medium">Thời gian tạo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--mimora-border)] tabular-nums">
                    {pastJobs.map((job) => (
                      <tr key={job.id}>
                        <td className="py-2.5 px-3 font-mono text-xs">{job.sourceFilename}</td>
                        <td className="py-2.5 px-3">
                          <Badge variant={job.status === 'validated' ? 'info' : job.failedRows > 0 ? 'warning' : 'success'}>
                            {job.status}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3 text-xs">
                          {job.totalRows} / {job.succeededRows} / {job.failedRows}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-[var(--mimora-muted)]">
                          {formatDateTime(job.createdAt, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={confirmCommitOpen}
        onClose={() => setConfirmCommitOpen(false)}
        title="Xác nhận nhập tài khoản học sinh thật"
        description={`Hệ thống sẽ tạo tối đa ${readyRowsCount} tài khoản học sinh mới dựa trên kết quả kiểm tra trước. Thao tác này ghi dữ liệu trực tiếp vào hệ thống.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmCommitOpen(false)}>
              Quay lại kiểm tra
            </Button>
            <Button variant="primary" onClick={() => void runCommit()}>
              Xác nhận tạo tài khoản
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--mimora-muted)] leading-relaxed">
          Chỉ các dòng có đủ <span className="font-mono">org_username</span>,{' '}
          <span className="font-mono">display_name</span> và{' '}
          <span className="font-mono">initial_password</span> mới được tạo tài khoản. Học sinh
          đăng nhập bằng mã trường, <span className="font-mono">org_username</span> và mật khẩu
          khởi tạo.
        </p>
      </Dialog>
    </div>
  );
}
