import { CheckCircle2, Info, SlidersHorizontal, UserCheck } from 'lucide-react';
import { Alert } from '../ui/Alert.tsx';
import { Card, CardContent, CardHeader } from '../ui/Card.tsx';
import { PageHeader } from '../ui/Navigation.tsx';
import type {
  SafeStudentProfileView,
  StudentAccessibilityRuntime,
} from '../../types/student.ts';

export interface StudentSettingsPageProps {
  profile: SafeStudentProfileView | null;
  profileLoading: boolean;
  profileError: string | null;
  accessibility: StudentAccessibilityRuntime;
  onChangeAccessibility: (next: StudentAccessibilityRuntime) => void;
}

function translateCommModeVi(mode?: string): string {
  switch (mode) {
    case 'aac':
      return 'Ưu tiên thẻ AAC';
    case 'read_aloud':
      return 'Ưu tiên đọc to';
    case 'visual':
      return 'Ưu tiên hình ảnh';
    case 'mixed':
      return 'Kết hợp nhiều hỗ trợ';
    default:
      return 'Chưa chỉ định';
  }
}

export function StudentSettingsPage({
  profile,
  profileLoading,
  profileError,
  accessibility,
  onChangeAccessibility,
}: StudentSettingsPageProps) {
  const prefs = profile?.supportPreferencesJson ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        metadataLine="Tiếp cận & Hỗ trợ học tập"
        title="Cài đặt thoải mái khi học"
        description="Điều chỉnh chữ, chuyển động, độ tương phản và đọc to sao cho dễ chịu nhất với con."
      />

      {/* Server-backed Student Support Profile (Read-Only from Teacher P2-07) */}
      <Card tone="mint" padding="lg">
        <CardHeader
          title="Hồ sơ hỗ trợ học tập từ thầy cô (chỉ xem)"
          description="Thầy cô thiết lập sẵn các tùy chọn này để màn hình tự động thân thiện với con ngay khi đăng nhập."
        />
        <CardContent className="space-y-3">
          {profileLoading ? (
            <p className="text-sm text-[var(--mimora-muted)]">Đang tải hồ sơ hỗ trợ...</p>
          ) : profileError ? (
            <Alert variant="warning">{profileError}</Alert>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="rounded-[var(--mimora-radius-md)] bg-[var(--mimora-surface)] border border-[var(--mimora-border)] p-3.5 space-y-1">
                <p className="text-xs font-medium text-[var(--mimora-muted)] flex items-center gap-1.5">
                  <UserCheck className="h-3.5 w-3.5 text-[var(--mimora-primary)]" aria-hidden="true" />
                  <span>Tên gọi thân thiện</span>
                </p>
                <p className="font-semibold text-[var(--mimora-text)]">
                  {profile?.preferredName || 'Dùng tên hiển thị mặc định'}
                </p>
              </div>

              <div className="rounded-[var(--mimora-radius-md)] bg-[var(--mimora-surface)] border border-[var(--mimora-border)] p-3.5 space-y-1">
                <p className="text-xs font-medium text-[var(--mimora-muted)]">
                  Hình thức giao tiếp ưu tiên
                </p>
                <p className="font-semibold text-[var(--mimora-text)]">
                  {translateCommModeVi(prefs?.preferredCommunicationMode)}
                </p>
              </div>

              <div className="rounded-[var(--mimora-radius-md)] bg-[var(--mimora-surface)] border border-[var(--mimora-border)] p-3.5 space-y-1">
                <p className="text-xs font-medium text-[var(--mimora-muted)]">
                  Công cụ hỗ trợ được bật từ hồ sơ
                </p>
                <p className="font-semibold text-[var(--mimora-text)]">
                  {prefs
                    ? [
                        prefs.aacEnabled !== false ? 'Thẻ AAC' : null,
                        prefs.readAloudEnabled !== false ? 'Đọc to' : null,
                        prefs.speechRate === 'slow' ? 'Đọc chậm' : 'Đọc bình thường',
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : 'Mặc định (Thẻ AAC · Đọc to)'}
                </p>
              </div>

              <div className="rounded-[var(--mimora-radius-md)] bg-[var(--mimora-surface)] border border-[var(--mimora-border)] p-3.5 space-y-1">
                <p className="text-xs font-medium text-[var(--mimora-muted)]">
                  Ghi chú cảm giác từ thầy cô
                </p>
                <p className="text-[var(--mimora-text)]">
                  {prefs?.sensoryNotes || 'Chưa có ghi chú thêm.'}
                </p>
              </div>
            </div>
          )}

          <p className="text-xs text-[var(--mimora-muted)] flex items-start gap-1.5 pt-1">
            <Info className="h-4 w-4 text-[var(--mimora-primary)] shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Hồ sơ hỗ trợ trên máy chủ do thầy cô cập nhật để đảm bảo phù hợp tại lớp. Con có thể
              tùy chỉnh thêm chế độ hiển thị ngay trong phiên học ở phần bên dưới.
            </span>
          </p>
        </CardContent>
      </Card>

      {/* Local Session UI Comfort Overrides (React state only, zero localStorage) */}
      <Card tone="default" padding="lg">
        <CardHeader
          title="Tùy chỉnh hiển thị trong phiên học này"
          description="Thay đổi có hiệu lực ngay trên màn hình hiện tại (chỉ lưu trong bộ nhớ phiên học)."
          action={<SlidersHorizontal className="h-5 w-5 text-[var(--mimora-primary)]" aria-hidden="true" />}
        />
        <CardContent className="space-y-3">
          {(
            [
              {
                key: 'largeText',
                label: 'Cỡ chữ lớn hơn khi đọc thẻ và câu chuyện',
                checked: accessibility.largeText,
                onChange: (checked: boolean) =>
                  onChangeAccessibility({ ...accessibility, largeText: checked }),
              },
              {
                key: 'reducedMotion',
                label: 'Giảm chuyển động trên màn hình',
                checked: accessibility.reducedMotion,
                onChange: (checked: boolean) =>
                  onChangeAccessibility({ ...accessibility, reducedMotion: checked }),
              },
              {
                key: 'highContrast',
                label: 'Tăng độ tương phản chữ và khung viền',
                checked: accessibility.highContrast,
                onChange: (checked: boolean) =>
                  onChangeAccessibility({ ...accessibility, highContrast: checked }),
              },
              {
                key: 'aacEnabled',
                label: 'Hiển thị thanh Thẻ giao tiếp nhanh (AAC) dưới mỗi bài',
                checked: accessibility.aacEnabled,
                onChange: (checked: boolean) =>
                  onChangeAccessibility({ ...accessibility, aacEnabled: checked }),
              },
              {
                key: 'readAloudEnabled',
                label: 'Hiển thị nút Đọc to (Read-Aloud) khi cần nghe',
                checked: accessibility.readAloudEnabled,
                onChange: (checked: boolean) =>
                  onChangeAccessibility({ ...accessibility, readAloudEnabled: checked }),
              },
              {
                key: 'slowSpeech',
                label: 'Đọc to với tốc độ chậm rãi hơn',
                checked: accessibility.speechRate === 'slow',
                onChange: (checked: boolean) =>
                  onChangeAccessibility({
                    ...accessibility,
                    speechRate: checked ? 'slow' : 'normal',
                  }),
              },
            ] as const
          ).map((toggle) => (
            <label
              key={toggle.key}
              className="flex items-center justify-between gap-4 rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] p-4 cursor-pointer hover:bg-[var(--mimora-surface-subtle)]"
            >
              <span className="text-sm sm:text-base font-medium text-[var(--mimora-text)] flex items-center gap-2">
                {toggle.checked && (
                  <CheckCircle2
                    className="h-4 w-4 text-[var(--mimora-primary)] shrink-0"
                    aria-hidden="true"
                  />
                )}
                <span>{toggle.label}</span>
              </span>
              <input
                type="checkbox"
                checked={toggle.checked}
                onChange={(e) => toggle.onChange(e.target.checked)}
                className="h-5 w-5 accent-[var(--mimora-primary)] cursor-pointer shrink-0"
              />
            </label>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
