import {
  Compass,
  Home,
  KeyRound,
  LogOut,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClientError } from '../api/client.ts';
import { studentApi } from '../api/student.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import { ChangePasswordModal } from '../components/auth/ChangePasswordModal.tsx';
import { MimoraBrandMark } from '../components/illustrations/SelIllustrations.tsx';
import {
  ActivityCardPreview,
  ChapterPathOutline,
  EmotionCardPreview,
  SAMPLE_EMOTION_CARDS,
  SAMPLE_STRATEGY_CARDS,
  StrategyCardPreview,
} from '../components/sel-preview/SelResourceCards.tsx';
import { ChapterWorkspace } from '../components/student/ChapterWorkspace.tsx';
import { StudentAssignmentDetailPage } from '../components/student/StudentAssignmentDetailPage.tsx';
import { StudentHomePage } from '../components/student/StudentHomePage.tsx';
import { StudentSettingsPage } from '../components/student/StudentSettingsPage.tsx';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Dropdown,
  PageHeader,
  ResponsiveShell,
  Toast,
} from '../components/ui/index.ts';
import { getMessages, resolveLocalizedErrorMessage } from '../i18n/index.ts';
import type {
  SafeStudentAssignmentDetailView,
  SafeStudentAssignmentListItemView,
  SafeStudentGoalView,
  SafeStudentProfileView,
  StudentAccessibilityRuntime,
} from '../types/student.ts';

type StudentSection = 'home' | 'chapters' | 'cards_preview' | 'settings';

export function StudentLayout() {
  const { context, logout, locale } = useAuth();
  const t = getMessages(locale);

  const [section, setSection] = useState<StudentSection>('home');
  const [selectedEmotionKey, setSelectedEmotionKey] = useState<string>('calm');
  const [selectedStrategyKey, setSelectedStrategyKey] = useState<string>('slow_breath');

  // Student accessibility runtime hydrated from /api/v1/student/profile + session toggles
  const [accessibility, setAccessibility] = useState<StudentAccessibilityRuntime>({
    largeText: false,
    reducedMotion: false,
    highContrast: false,
    aacEnabled: true,
    readAloudEnabled: true,
    speechRate: 'normal',
  });

  // Real backend student data states
  const [profile, setProfile] = useState<SafeStudentProfileView | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'active' | 'closed'>('active');
  const [assignments, setAssignments] = useState<SafeStudentAssignmentListItemView[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [assignmentsError, setAssignmentsError] = useState<string | null>(null);

  const [goals, setGoals] = useState<SafeStudentGoalView[]>([]);
  const [goalsLoading, setGoalsLoading] = useState(false);
  const [goalsError, setGoalsError] = useState<string | null>(null);

  // Assignment Detail & Chapter Workspace state
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
  const [assignmentDetail, setAssignmentDetail] =
    useState<SafeStudentAssignmentDetailView | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceItemIndex, setWorkspaceItemIndex] = useState(0);
  const detailSeqRef = useRef(0);

  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const loadProfileAndGoals = useCallback(async () => {
    setProfileLoading(true);
    setProfileError(null);
    setGoalsLoading(true);
    setGoalsError(null);

    try {
      const [profileRes, goalsRes] = await Promise.allSettled([
        studentApi.getProfile(),
        studentApi.listGoals({ page: 1, limit: 20 }),
      ]);

      if (profileRes.status === 'fulfilled') {
        const fetched = profileRes.value.profile;
        setProfile(fetched);
        const prefs = fetched.supportPreferencesJson;
        if (prefs) {
          setAccessibility((prev) => ({
            ...prev,
            reducedMotion: prefs.reducedMotion ?? prev.reducedMotion,
            highContrast: prefs.visualContrast === 'high_contrast' ? true : prev.highContrast,
            aacEnabled: prefs.aacEnabled ?? prev.aacEnabled,
            readAloudEnabled: prefs.readAloudEnabled ?? prev.readAloudEnabled,
            speechRate: prefs.speechRate ?? prev.speechRate,
          }));
        }
      } else {
        const reason = profileRes.reason;
        setProfileError(
          reason instanceof ApiClientError
            ? resolveLocalizedErrorMessage(reason.info, locale)
            : 'Không thể tải hồ sơ hỗ trợ lúc này.'
        );
      }

      if (goalsRes.status === 'fulfilled') {
        setGoals(goalsRes.value.items);
      } else {
        const reason = goalsRes.reason;
        setGoalsError(
          reason instanceof ApiClientError
            ? resolveLocalizedErrorMessage(reason.info, locale)
            : 'Không thể tải mục tiêu đồng hành lúc này.'
        );
      }
    } finally {
      setProfileLoading(false);
      setGoalsLoading(false);
    }
  }, [locale]);

  const loadAssignments = useCallback(
    async (filter: 'active' | 'closed') => {
      setAssignmentsLoading(true);
      setAssignmentsError(null);
      try {
        const res = await studentApi.listAssignments({ status: filter, page: 1, limit: 20 });
        setAssignments(res.items);
      } catch (err) {
        setAssignmentsError(
          err instanceof ApiClientError
            ? resolveLocalizedErrorMessage(err.info, locale)
            : 'Không thể tải danh sách bài tập lúc này.'
        );
      } finally {
        setAssignmentsLoading(false);
      }
    },
    [locale]
  );

  const loadAssignmentDetail = useCallback(
    async (assignmentId: string) => {
      const seq = ++detailSeqRef.current;
      setDetailLoading(true);
      setDetailError(null);
      try {
        const res = await studentApi.getAssignmentDetail(assignmentId);
        if (seq !== detailSeqRef.current) {
          return;
        }
        setAssignmentDetail(res.assignment);
      } catch (err) {
        if (seq !== detailSeqRef.current) {
          return;
        }
        setDetailError(
          err instanceof ApiClientError
            ? resolveLocalizedErrorMessage(err.info, locale)
            : 'Không thể mở chi tiết bài tập.'
        );
      } finally {
        if (seq === detailSeqRef.current) {
          setDetailLoading(false);
        }
      }
    },
    [locale]
  );

  useEffect(() => {
    if (!context) {
      return;
    }
    void loadProfileAndGoals();
  }, [context, loadProfileAndGoals]);

  useEffect(() => {
    if (!context) {
      return;
    }
    void loadAssignments(statusFilter);
  }, [context, statusFilter, loadAssignments]);

  if (!context) {
    return null;
  }

  const activeOrg = context.activeOrganization;
  const studentDisplayName = profile?.preferredName?.trim() || context.user.displayName;

  const navItems: Array<{ id: StudentSection; label: string; icon: React.ReactNode }> = [
    { id: 'home', label: t.student.navHome, icon: <Home className="h-5 w-5" aria-hidden="true" /> },
    { id: 'chapters', label: t.student.navChapters, icon: <Compass className="h-5 w-5" aria-hidden="true" /> },
    { id: 'cards_preview', label: t.student.navLibraryPreview, icon: <Sparkles className="h-5 w-5" aria-hidden="true" /> },
    { id: 'settings', label: t.student.navSettings, icon: <SlidersHorizontal className="h-5 w-5" aria-hidden="true" /> },
  ];

  const accessibilityWrapperClasses = [
    accessibility.largeText ? 'mimora-text-large' : '',
    accessibility.reducedMotion ? 'mimora-reduced-motion' : '',
    accessibility.highContrast ? 'mimora-high-contrast' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const handleOpenAssignment = (assignmentId: string) => {
    setSection('home');
    setSelectedAssignmentId(assignmentId);
    setAssignmentDetail(null);
    setWorkspaceOpen(false);
    void loadAssignmentDetail(assignmentId);
  };

  const handleBackToHomeList = () => {
    detailSeqRef.current += 1;
    setWorkspaceOpen(false);
    setSelectedAssignmentId(null);
    setAssignmentDetail(null);
    void loadAssignments(statusFilter);
  };

  return (
    <div className={accessibilityWrapperClasses}>
      <ResponsiveShell
        studentFriendly
        brandLogo={<MimoraBrandMark />}
        brandTitle={t.app.brand}
        portalLabel={t.student.portalName}
        skipLabel={t.app.skipToContent}
        navItems={navItems}
        activeNavId={section}
        onSelectNav={(id) => {
          const next = id as StudentSection;
          setSection(next);
          if (next === 'home') {
            setWorkspaceOpen(false);
          }
        }}
        headerRightAction={
          <Dropdown
            triggerLabel={studentDisplayName}
            triggerIcon={<Avatar name={studentDisplayName} tone="peach" size="sm" />}
            items={[
              {
                id: 'comfort-settings',
                label: t.student.navSettings,
                icon: <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />,
                onSelect: () => setSection('settings'),
              },
              {
                id: 'change-password',
                label: t.auth.changePassword,
                icon: <KeyRound className="h-4 w-4" aria-hidden="true" />,
                onSelect: () => setChangePwdOpen(true),
              },
              {
                id: 'logout',
                label: t.auth.logout,
                icon: <LogOut className="h-4 w-4" aria-hidden="true" />,
                danger: true,
                onSelect: () => void logout(),
              },
            ]}
          />
        }
        sidebarFooter={
          <div className="space-y-2 text-xs text-[var(--mimora-muted)]">
            <p className="font-medium text-[var(--mimora-text)]">
              {activeOrg ? `${activeOrg.name} (${activeOrg.code})` : t.roles.student}
            </p>
            <p className="leading-relaxed">{t.student.calmStatusLabel}</p>
          </div>
        }
      >
        {toastMsg && (
          <Toast variant="success" message={toastMsg} onDismiss={() => setToastMsg(null)} />
        )}

        {section === 'home' && !selectedAssignmentId && (
          <StudentHomePage
            displayName={context.user.displayName}
            profile={profile}
            assignments={assignments}
            assignmentsLoading={assignmentsLoading}
            assignmentsError={assignmentsError}
            statusFilter={statusFilter}
            onChangeStatusFilter={(next) => setStatusFilter(next)}
            onRetryLoadAssignments={() => void loadAssignments(statusFilter)}
            goals={goals}
            goalsLoading={goalsLoading}
            goalsError={goalsError}
            onRetryLoadGoals={() => void loadProfileAndGoals()}
            onOpenAssignment={handleOpenAssignment}
            onOpenChaptersOverview={() => setSection('chapters')}
            onOpenSampleCards={() => setSection('cards_preview')}
            onOpenSettings={() => setSection('settings')}
          />
        )}

        {section === 'home' && selectedAssignmentId && !workspaceOpen && (
          <StudentAssignmentDetailPage
            assignment={assignmentDetail}
            loading={detailLoading}
            error={detailError}
            onRetryLoad={() => void loadAssignmentDetail(selectedAssignmentId)}
            onBackHome={handleBackToHomeList}
            onStartWorkspace={(itemIdx = 0) => {
              setWorkspaceItemIndex(itemIdx);
              setWorkspaceOpen(true);
            }}
          />
        )}

        {section === 'home' && selectedAssignmentId && workspaceOpen && assignmentDetail && (
          <ChapterWorkspace
            assignment={assignmentDetail}
            initialItemIndex={workspaceItemIndex}
            locale={locale}
            accessibility={accessibility}
            onBackToDetail={() => {
              setWorkspaceOpen(false);
              void loadAssignmentDetail(selectedAssignmentId);
            }}
            onAssignmentProgressMutated={() => {
              void loadAssignments(statusFilter);
            }}
          />
        )}

        {section === 'chapters' && (
          <div className="space-y-6">
            <PageHeader
              metadataLine="Lộ trình học tập MIMORA · 3 Buổi · 6 Bước"
              title={t.student.navChapters}
              description="Cấu trúc học tập nhẹ nhàng giúp trẻ quan sát tình huống, lắng nghe cơ thể, chọn chiến lược và giải quyết vấn đề an toàn."
            />

            {assignments.length > 0 && (
              <Card tone="mint" padding="md" className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-[var(--mimora-text)]">
                    Con đang có {assignments.length} bài tập trong mục này
                  </p>
                  <p className="text-xs text-[var(--mimora-muted)]">
                    Bấm để mở ngay bài tập “{assignments[0].title}” trong không gian 3 Buổi · 6 Bước.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={() => handleOpenAssignment(assignments[0].id)}
                >
                  Mở bài tập của con
                </Button>
              </Card>
            )}

            <ChapterPathOutline />
          </div>
        )}

        {section === 'cards_preview' && (
          <div className="space-y-6">
            <PageHeader
              metadataLine="Mẫu tham khảo giao diện"
              title={t.student.previewSectionTitle}
              description={t.student.previewDisclaimer}
            />

            <Alert variant="info">{t.student.previewDisclaimer}</Alert>

            <ActivityCardPreview
              chapterLabel="Mẫu minh họa: Giờ ra chơi ở sân trường"
              title="Câu chuyện nhỏ về việc chờ đến lượt"
              sceneSummary="Minh họa cách thẻ câu chuyện và thẻ cảm xúc/chiến lược hiển thị dịu mắt trong không gian học."
            />

            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-[var(--mimora-text)]">
                Thẻ Cảm xúc (mẫu minh họa không gắn nhãn đúng/sai)
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {SAMPLE_EMOTION_CARDS.map((card) => (
                  <EmotionCardPreview
                    key={card.key}
                    card={card}
                    selected={selectedEmotionKey === card.key}
                    onSelect={() => setSelectedEmotionKey(card.key)}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-[var(--mimora-text)]">
                Thẻ Chiến lược hỗ trợ (mẫu minh họa)
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {SAMPLE_STRATEGY_CARDS.map((card) => (
                  <StrategyCardPreview
                    key={card.key}
                    card={card}
                    selected={selectedStrategyKey === card.key}
                    onSelect={() => setSelectedStrategyKey(card.key)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {section === 'settings' && (
          <StudentSettingsPage
            profile={profile}
            profileLoading={profileLoading}
            profileError={profileError}
            accessibility={accessibility}
            onChangeAccessibility={setAccessibility}
          />
        )}

        <ChangePasswordModal
          open={changePwdOpen}
          onClose={() => setChangePwdOpen(false)}
          onSuccess={(msg) => setToastMsg(msg)}
        />
      </ResponsiveShell>
    </div>
  );
}
