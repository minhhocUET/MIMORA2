import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../../api/admin.ts';
import { ApiClientError } from '../../api/client.ts';
import { resolveLocalizedErrorMessage, type AppLocale } from '../../i18n/index.ts';
import type { CsvImportJobView, SafeClassView, SafeOrganizationView } from '../../types/admin.ts';
import { CsvImportPanel } from '../shared/CsvImportPanel.tsx';
import { Alert, Card, EmptyState, FormField, PageHeader, Select } from '../ui/index.ts';

export interface AdminCsvImportPageProps {
  locale: AppLocale;
  onToast: (msg: string) => void;
}

export function AdminCsvImportPage({ locale, onToast }: AdminCsvImportPageProps) {
  const [orgs, setOrgs] = useState<SafeOrganizationView[]>([]);
  const [orgId, setOrgId] = useState('');
  const [classes, setClasses] = useState<SafeClassView[]>([]);
  const [targetClassId, setTargetClassId] = useState('');
  const [jobs, setJobs] = useState<CsvImportJobView[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadError(null);
    adminApi
      .listOrganizations({ page: 1, limit: 100 })
      .then((res) => {
        if (!active) return;
        setOrgs(res.items);
        if (res.items.length > 0) {
          setOrgId(res.items[0].id);
        }
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(
          err instanceof ApiClientError
            ? resolveLocalizedErrorMessage(err.info, locale)
            : 'Không thể tải danh sách tổ chức / trường học.'
        );
      });
    return () => {
      active = false;
    };
  }, [locale]);

  const loadOrgContext = useCallback(async () => {
    if (!orgId) {
      setClasses([]);
      setJobs([]);
      return;
    }
    setLoadingJobs(true);
    setLoadError(null);
    try {
      const [clsRes, jobsRes] = await Promise.all([
        adminApi.listOrganizationClasses(orgId, { page: 1, limit: 100, status: 'active' }),
        adminApi.listCsvImports(orgId, { page: 1, limit: 20 }),
      ]);
      setClasses(clsRes.items);
      setJobs(jobsRes.items);
    } catch (err) {
      setClasses([]);
      setJobs([]);
      setLoadError(
        err instanceof ApiClientError
          ? resolveLocalizedErrorMessage(err.info, locale)
          : 'Không thể tải danh sách lớp hoặc lịch sử nhập CSV.'
      );
    } finally {
      setLoadingJobs(false);
    }
  }, [orgId, locale]);

  useEffect(() => {
    setTargetClassId('');
    void loadOrgContext();
  }, [loadOrgContext]);

  return (
    <div className="space-y-6">
      <PageHeader
        metadataLine="Cổng Quản trị · P2-03"
        title="Nhập danh sách học sinh bằng CSV"
        description="Hỗ trợ kiểm tra trước (Preview) và tạo tài khoản hàng loạt vào trường hoặc ghi danh trực tiếp vào một lớp."
      />

      {loadError && <Alert variant="danger">{loadError}</Alert>}

      {orgs.length === 0 && !loadError ? (
        <EmptyState
          title="Chưa có tổ chức nào để nhập CSV"
          description="Hãy tạo ít nhất một tổ chức trong mục Tổ chức & Trường học trước khi nhập danh sách học sinh."
        />
      ) : orgs.length === 0 ? null : (
        <>
          <Card padding="sm">
            <FormField label="Chọn tổ chức / trường đích" htmlFor="admin-csv-org">
              <Select
                id="admin-csv-org"
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                options={orgs.map((o) => ({ value: o.id, label: `${o.name} (${o.code})` }))}
              />
            </FormField>
          </Card>

          <CsvImportPanel
            locale={locale}
            title="Công cụ nhập học sinh CSV cấp tổ chức"
            description="Kiểm tra định dạng, trùng lặp org_username và lỗi từng dòng trước khi xác nhận tạo tài khoản."
            allowOptionalClass
            classOptions={classes.map((c) => ({ value: c.id, label: c.name }))}
            selectedClassId={targetClassId}
            onSelectClassId={setTargetClassId}
            onExecuteImport={({ mode, sourceFilename, csvContent, targetClassId: clsId }) =>
              adminApi.runCsvImport(orgId, {
                mode,
                sourceFilename,
                csvContent,
                targetClassId: clsId,
              })
            }
            pastJobs={jobs}
            loadingJobs={loadingJobs}
            onCommitted={loadOrgContext}
            onToast={onToast}
          />
        </>
      )}
    </div>
  );
}
