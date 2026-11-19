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
  SafeStudentFamilyPreferencesView,
  SafeStudentFamilyProgramDetailView,
  SafeStudentFamilyProgramSummaryView,
  SafeStudentGoalView,
  SafeStudentProfileView,
  StudentAccessibilityRuntime,
} from '../types/student.ts';

type StudentSection = 'home' | 'chapters' | 'cards_preview' | 'settings';

function toNormalizedFamilyDetailView(
  detail: SafeStudentFamilyProgramDetailView
): SafeStudentAssignmentDetailView {
  const prog = detail.program;
  return {
    id: prog.enrollmentId,
    organizationId: prog.familyWorkspaceId,
    classId: prog.familyProgramId,
    className: `${prog.workspaceName} · Phiên bản v${prog.versionNumber}`,
    targetId: prog.enrollmentId,
    title: prog.title,
    status: 'active',
    isReadOnly: false,
    dueAt: null,
    isPastDue: false,
    homePracticeInstructions: prog.description,
    homePractice: {
      hasInstructions: Boolean(prog.description),
      instructions: prog.description,
      printableGuide: {
        assignmentTitle: prog.title,
        className: prog.workspaceName,
        dueAt: null,
        instructions: prog.description,
        activityTitles: detail.items.map((it) => it.pinnedContentVersion.title),
      },
    },
    assignedAt: prog.startedAt ?? new Date().toISOString(),
    createdAt: prog.startedAt ?? new Date().toISOString(),
    updatedAt: prog.lastActivityAt ?? new Date().toISOString(),
    items: detail.items.map((it) => ({
      assignmentItemId: it.itemId,
      sortOrder: it.sortOrder,
      contentItemId: it.pinnedContentVersion.contentItemId,
      contentVersionId: it.pinnedContentVersion.contentVersionId,
      slug: `ch${it.chapterNumber}-${it.sortOrder}`,
      contentType: it.pinnedContentVersion.contentType,
      versionNumber: it.pinnedContentVersion.versionNumber,
      title: it.pinnedContentVersion.title,
      summary: it.pinnedContentVersion.summary,
      locale: it.pinnedContentVersion.locale,
      payloadJson: it.pinnedContentVersion.payloadJson,
      metadataJson: it.pinnedContentVersion.metadataJson,
      publishedAt: null,
    })),
    progress: {
      hasProgressRecord: true,
      status: prog.learningStatus,
      totalItems: prog.totalActivities,
      completedItems: prog.completedActivities,
      attemptCount: prog.completedActivities,
      lastActivityAt: prog.lastActivityAt,
      completedAt: prog.completedAt,
    },
  };
}

export function StudentLayout() {
  const { context, logout, locale } = useAuth();
  const t = getMessages(locale);

  const [section, setSection] = useState<StudentSection>('home');
  const [selectedEmotionKey, setSelectedEmotionKey] = useState<string>('calm');
  const [selectedStrategyKey, setSelectedStrategyKey] = useState<string>('slow_breath');

  // Student accessibility runtime hydrated from family preferences and/or school profile
  const [accessibility, setAccessibility] = useState<StudentAccessibilityRuntime>({
    largeText: false,
    reducedMotion: false,
    highContrast: false,
    aacEnabled: true,
    readAloudEnabled: true,
    speechRate: 'normal',
  });

  // Canonical Student Family Preferences (works with or without school org)
  const [familyPreferences, setFamilyPreferences] =
    useState<SafeStudentFamilyPreferencesView | null>(null);
  const [familyPrefsLoading, setFamilyPrefsLoading] = useState(false);
  const [familyPrefsError, setFamilyPrefsError] = useState<string | null>(null);
  const [savingFamilyPrefs, setSavingFamilyPrefs] = useState(false);

  // Teacher-free Family Programs state
  const [familyPrograms, setFamilyPrograms] = useState<
    SafeStudentFamilyProgramSummaryView[]
  >([]);
  const [familyProgramsLoading, setFamilyProgramsLoading] = useState(false);
  const [familyProgramsError, setFamilyProgramsError] = useState<string | null>(null);

  // School backend student data states
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

  // Selected activity container (either School Assignment or Family Program)
  const [selectedContext, setSelectedContext] = useState<
    { type: 'school'; id: string } | { type: 'family'; enrollmentId: string } | null
  >(null);
  const [assignmentDetail, setAssignmentDetail] =
    useState<SafeStudentAssignmentDetailView | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceItemIndex, setWorkspaceItemIndex] = useState(0);
  const detailSeqRef = useRef(0);

  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const loadFamilyData = useCallback(async () => {
    setFamilyPrefsLoading(true);
    setFamilyPrefsError(null);
    setFamilyProgramsLoading(true);
    setFamilyProgramsError(null);

    try {
      const [prefsRes, progsRes] = await Promise.allSettled([
        studentApi.getFamilyPreferences(),
        studentApi.listFamilyPrograms(),
      ]);

      if (prefsRes.status === 'fulfilled') {
        const fetched = prefsRes.value.preferences;
        setFamilyPreferences(fetched);
        const p = fetched.supportPreferencesJson;
        if (p) {
          setAccessibility((prev) => ({
            ...prev,
            reducedMotion: p.reducedMotion ?? prev.reducedMotion,
            highContrast:
              p.visualContrast === 'high_contrast'
                ? true
                : p.visualContrast === 'standard'
                  ? false
                  : prev.highContrast,
            aacEnabled: p.aacEnabled ?? prev.aacEnabled,
            readAloudEnabled: p.readAloudEnabled ?? prev.readAloudEnabled,
            speechRate: p.speechRate ?? prev.speechRate,
            largeText:
              Array.isArray(p.preferredVisualCues) &&
              p.preferredVisualCues.includes('large_text')
                ? true
                : prev.largeText,
          }));
        }
      } else {
        const reason = prefsRes.reason;
        setFamilyPrefsError(
          reason instanceof ApiClientError
            ? resolveLocalizedErrorMessage(reason.info, locale)
            : 'Không thể tải tùy chọn thoải mái cá nhân.'
        );
      }

      if (progsRes.status === 'fulfilled') {
        setFamilyPrograms(progsRes.value.programs);
      } else {
        const reason = progsRes.reason;
        setFamilyProgramsError(
          reason instanceof ApiClientError
            ? resolveLocalizedErrorMessage(reason.info, locale)
            : 'Không thể tải danh sách chương trình gia đình lúc này.'
        );
      }
    } finally {
      setFamilyPrefsLoading(false);
      setFamilyProgramsLoading(false);
    }
  }, [locale]);

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

  const loadFamilyProgramDetail = useCallback(
    async (enrollmentId: string) => {
      const seq = ++detailSeqRef.current;
      setDetailLoading(true);
      setDetailError(null);
      try {
        const res = await studentApi.getFamilyProgramDetail(enrollmentId);
        if (seq !== detailSeqRef.current) {
          return;
        }
        setAssignmentDetail(toNormalizedFamilyDetailView(res));
      } catch (err) {
        if (seq !== detailSeqRef.current) {
          return;
        }
        setDetailError(
          err instanceof ApiClientError
            ? resolveLocalizedErrorMessage(err.info, locale)
            : 'Không thể mở chi tiết chương trình gia đình.'
        );
      } finally {
        if (seq === detailSeqRef.current) {
          setDetailLoading(false);
        }
      }
    },
    [locale]
  );

  const activeOrg = context?.activeOrganization ?? null;
  const hasSchoolContext = Boolean(activeOrg);

  useEffect(() => {
    if (!context) return;
    void loadFamilyData();
  }, [context, loadFamilyData]);

  useEffect(() => {
    if (!context || !hasSchoolContext) {
      setProfile(null);
      setGoals([]);
      setProfileLoading(false);
      setGoalsLoading(false);
      return;
    }
    void loadProfileAndGoals();
  }, [context, hasSchoolContext, loadProfileAndGoals]);

  useEffect(() => {
    if (!context || !hasSchoolContext) {
      setAssignments([]);
      setAssignmentsLoading(false);
      return;
    }
    void loadAssignments(statusFilter);
  }, [context, hasSchoolContext, statusFilter, loadAssignments]);

  if (!context) {
    return null;
  }

  const studentDisplayName =
    familyPreferences?.preferredName?.trim() ||
    profile?.preferredName?.trim() ||
    context.user.displayName;

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
    setSelectedContext({ type: 'school', id: assignmentId });
    setAssignmentDetail(null);
    setWorkspaceOpen(false);
    void loadAssignmentDetail(assignmentId);
  };

  const handleOpenFamilyProgram = (enrollmentId: string) => {
    setSection('home');
    setSelectedContext({ type: 'family', enrollmentId });
    setAssignmentDetail(null);
    setWorkspaceOpen(false);
    void loadFamilyProgramDetail(enrollmentId);
  };

  const handleBackToHomeList = () => {
    detailSeqRef.current += 1;
    setWorkspaceOpen(false);
    setSelectedContext(null);
    setAssignmentDetail(null);
    void loadFamilyData();
    if (hasSchoolContext) {
      void loadAssignments(statusFilter);
    }
  };

  const handleSaveFamilyPreferences = async (input: {
    preferredName: string | null;
    accessibility: StudentAccessibilityRuntime;
  }) => {
    setSavingFamilyPrefs(true);
    setFamilyPrefsError(null);
    try {
      const res = await studentApi.updateFamilyPreferences({
        preferredName: input.preferredName,
        supportPreferencesJson: {
          aacEnabled: input.accessibility.aacEnabled,
          readAloudEnabled: input.accessibility.readAloudEnabled,
          speechRate: input.accessibility.speechRate,
          reducedMotion: input.accessibility.reducedMotion,
          visualContrast: input.accessibility.highContrast ? 'high_contrast' : 'standard',
          preferredVisualCues: input.accessibility.largeText ? ['large_text'] : [],
        },
      });
      setFamilyPreferences(res.preferences);
      setToastMsg('Đã lưu cài đặt thoải mái của con.');
    } catch (err) {
      setFamilyPrefsError(
        err instanceof ApiClientError
          ? resolveLocalizedErrorMessage(err.info, locale)
          : 'Chưa thể lưu cài đặt thoải mái lúc này.'
      );
    } finally {
      setSavingFamilyPrefs(false);
    }
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
              {activeOrg
                ? `${activeOrg.name} (${activeOrg.code})`
                : `${t.student.familySpaceLabel} · ${t.roles.student}`}
            </p>
            <p className="leading-relaxed">{t.student.calmStatusLabel}</p>
          </div>
        }
      >
        {toastMsg && (
          <Toast variant="success" message={toastMsg} onDismiss={() => setToastMsg(null)} />
        )}

        {section === 'home' && !selectedContext && (
          <StudentHomePage
            displayName={context.user.displayName}
            preferredName={familyPreferences?.preferredName ?? null}
            hasSchoolContext={hasSchoolContext}
            profile={profile}
            familyPrograms={familyPrograms}
            familyProgramsLoading={familyProgramsLoading}
            familyProgramsError={familyProgramsError}
            onRetryLoadFamilyPrograms={() => void loadFamilyData()}
            onOpenFamilyProgram={handleOpenFamilyProgram}
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

        {section === 'home' && selectedContext && !workspaceOpen && (
          <StudentAssignmentDetailPage
            assignment={assignmentDetail}
            sourceContext={selectedContext.type}
            loading={detailLoading}
            error={detailError}
            onRetryLoad={() => {
              if (selectedContext.type === 'family') {
                void loadFamilyProgramDetail(selectedContext.enrollmentId);
              } else {
                void loadAssignmentDetail(selectedContext.id);
              }
            }}
            onBackHome={handleBackToHomeList}
            onStartWorkspace={(itemIdx = 0) => {
              setWorkspaceItemIndex(itemIdx);
              setWorkspaceOpen(true);
            }}
          />
        )}

        {section === 'home' && selectedContext && workspaceOpen && assignmentDetail && (
          <ChapterWorkspace
            assignment={assignmentDetail}
            transport={selectedContext.type}
            initialItemIndex={workspaceItemIndex}
            locale={locale}
            accessibility={accessibility}
            onBackToDetail={() => {
              setWorkspaceOpen(false);
              if (selectedContext.type === 'family') {
                void loadFamilyProgramDetail(selectedContext.enrollmentId);
              } else {
                void loadAssignmentDetail(selectedContext.id);
              }
            }}
            onAssignmentProgressMutated={() => {
              void loadFamilyData();
              if (hasSchoolContext) {
                void loadAssignments(statusFilter);
              }
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

            {familyPrograms.length > 0 && (
              <Card tone="mint" padding="md" className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-[var(--mimora-text)]">
                    Con đang có {familyPrograms.length} chương trình trong Không gian Gia đình
                  </p>
                  <p className="text-xs text-[var(--mimora-muted)]">
                    Bấm để mở ngay “{familyPrograms[0].title}” trong không gian 3 Buổi · 6 Bước.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={() => handleOpenFamilyProgram(familyPrograms[0].enrollmentId)}
                >
                  Mở chương trình gia đình
                </Button>
              </Card>
            )}

            {assignments.length > 0 && (
              <Card tone="mint" padding="md" className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-[var(--mimora-text)]">
                    Con đang có {assignments.length} bài tập ở trường
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
            hasSchoolContext={hasSchoolContext}
            profile={profile}
            profileLoading={profileLoading}
            profileError={profileError}
            familyPreferences={familyPreferences}
            familyPreferencesLoading={familyPrefsLoading}
            familyPreferencesError={familyPrefsError}
            onSaveFamilyPreferences={handleSaveFamilyPreferences}
            savingPreferences={savingFamilyPrefs}
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
