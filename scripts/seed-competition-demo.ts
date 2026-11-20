import crypto from 'node:crypto';
import fs from 'node:fs';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  assignmentItems,
  assignmentProgress,
  assignments,
  assignmentTargets,
  auditLogs,
  classEnrollments,
  classes,
  classTeachers,
  contentApprovals,
  contentItems,
  contentVersions,
  familyMemberships,
  familyProgramEnrollments,
  familyProgramItems,
  familyPrograms,
  familyProgramVersions,
  familyStudents,
  familyWorkspaces,
  guardianStudentLinks,
  organizationMemberships,
  organizations,
  studentFamilyPreferences,
  studentGoals,
  studentProfiles,
  teacherObservations,
  users,
} from '../src/server/db/schema/index.ts';
import {
  closeTiDbPool,
  getDb,
  resolveDatabasePolicy,
  withTransaction,
} from '../src/server/db/tidb.ts';
import { generateUuidV7 } from '../src/server/db/uuid.ts';
import { hashPassword } from '../src/server/security/password-hash.ts';
import { validateSupportPreferencesJson } from '../src/server/services/goal.service.ts';
import { validateUsernameFormat } from '../src/server/services/membership.service.ts';
import { normalizeOrganizationCode } from '../src/server/services/org.service.ts';
import {
  scanUnsafeSelText,
  validateContentPayloadAndMetadata,
} from '../src/server/validators/content-payload.schema.ts';

export const DEMO_CONSTANTS = {
  adminUsername: 'demo_admin',
  adminDisplayName: 'MIMORA Demo Admin',
  teacherUsername: 'demo_teacher',
  teacherDisplayName: 'MIMORA Demo Teacher',
  guardianEmail: 'demo.guardian@example.com',
  guardianDisplayName: 'MIMORA Demo Guardian',
  dualStudentUsername: 'demo_student_dual',
  dualStudentDisplayName: 'Minh Anh (Demo)',
  familyStudentUsername: 'demo_student_family',
  familyStudentDisplayName: 'Bảo An (Demo)',
  organizationCode: 'MIMORA-DEMO',
  organizationName: 'Trường Hòa Nhập Demo MIMORA',
  className: 'Lớp 1A - Hòa Nhập (Demo)',
  academicYear: '2026-2027',
  familyWorkspaceCode: 'FAM-DMO001',
  familyWorkspaceName: 'Gia đình Demo MIMORA',
  assignmentTitle: 'Tuần 1 (Demo): Nhận diện cảm xúc & Xin góc yên tĩnh',
  familyProgramSlug: 'demo-hanh-trinh-binh-tinh-tai-nha',
  familyProgramTitle: 'Hành trình Bình tĩnh & Giao tiếp tại nhà (Demo)',
  contentSlugs: {
    emotionPublished: 'demo-emotion-hoi-hop-nhe-nhang',
    situationPublished: 'demo-situation-cho-den-luot',
    actionPublished: 'demo-action-tho-cham-ba-nhip',
    communicationPublished: 'demo-comm-xin-khong-gian-yen-tinh',
    socialStoryPublished: 'demo-story-buoi-sang-diu-dang',
    situationPending: 'demo-situation-tieng-chuong-ra-choi-pending',
  },
} as const;

const EXPECTED_TABLES = [
  'organizations',
  'users',
  'organization_memberships',
  'sessions',
  'classes',
  'class_teachers',
  'class_enrollments',
  'student_profiles',
  'student_goals',
  'csv_import_jobs',
  'content_items',
  'content_versions',
  'content_approvals',
  'assignments',
  'assignment_items',
  'assignment_targets',
  'activity_attempts',
  'activity_attempt_turns',
  'assignment_progress',
  'teacher_observations',
  'org_insight_daily_snapshots',
  'audit_logs',
  'email_verification_tokens',
  'family_workspaces',
  'family_memberships',
  'family_students',
  'student_link_invitations',
  'guardian_student_links',
  'student_link_invitation_students',
  'family_programs',
  'family_program_versions',
  'family_program_items',
  'family_program_enrollments',
  'family_activity_attempts',
  'family_activity_attempt_turns',
  'student_family_preferences',
  '__drizzle_migrations',
] as const;

const EXPECTED_MIGRATION_HASHES = [
  'eec9f4669bf5f7850eb2cf5ca7f975585609334722e44ee4b5339ada2a16c765',
  '72afb616e99de3ee8cb20f211140710cf3547895486febc635acda53edb2e809',
  '27c9a6945932c14fe55fd34ec02150f9a4f87ee9b15806a1b9b562900f75b6b4',
] as const;

interface PreflightSummary {
  dbMode: string;
  database: string;
  isRuntimeUser: boolean;
  tlsActive: boolean;
  tlsCipher: string | null;
  hasRequiredGrants: boolean;
  tableCount: number;
  missingTables: string[];
  migrationCount: number;
  allExpectedMigrationsPresent: boolean;
  nonDemoUsersBefore: number;
}

interface GeneratedCredentialEntry {
  role: 'platform_admin' | 'teacher' | 'guardian' | 'student_dual' | 'student_family';
  displayName: string;
  loginMode: 'admin_teacher' | 'guardian' | 'student';
  identifierLabel: string;
  identifier: string;
  organizationOrWorkspaceCode: string | null;
  password: string;
}

function generateStrongDemoPassword(): string {
  // 18 chars URL-safe high entropy + deterministic alphanumeric diversity check
  const raw = crypto.randomBytes(14).toString('base64url');
  return `M1m!${raw}`;
}

function parseArgs(argv: string[]): { resultFile?: string } {
  let resultFile: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--result-file=')) {
      resultFile = arg.slice('--result-file='.length).trim();
    } else if (arg === '--result-file' && i + 1 < argv.length) {
      resultFile = argv[i + 1].trim();
      i += 1;
    }
  }
  return { resultFile };
}

function extractRows<T = Record<string, unknown>>(rawResult: unknown): T[] {
  if (Array.isArray(rawResult) && Array.isArray(rawResult[0])) {
    return rawResult[0] as T[];
  }
  if (Array.isArray(rawResult)) {
    return rawResult as T[];
  }
  return [];
}

async function runPreflight(): Promise<PreflightSummary> {
  const rawMode = process.env.MIMORA_DB_MODE?.trim().toLowerCase() ?? '';
  if (rawMode !== 'tidb') {
    throw new Error(
      `Preflight failed: MIMORA_DB_MODE must be "tidb", got "${rawMode || 'unset'}".`
    );
  }

  const policy = resolveDatabasePolicy(process.env);
  if (!policy.ok || policy.mode !== 'tidb') {
    throw new Error(
      `Preflight failed: TiDB Runtime configuration invalid (${policy.ok ? policy.mode : policy.error.code}).`
    );
  }

  const db = getDb();

  const ctxRows = extractRows<{
    dbName: string | null;
    currentUser: string | null;
  }>(
    await db.execute(
      sql`SELECT DATABASE() AS dbName, CURRENT_USER() AS currentUser`
    )
  );
  const dbName = ctxRows[0]?.dbName ?? '';
  const currentUser = ctxRows[0]?.currentUser ?? '';

  if (dbName !== 'test') {
    throw new Error(`Preflight failed: DATABASE() expected "test", got "${dbName}".`);
  }
  if (!currentUser || currentUser.toLowerCase().includes('migrator')) {
    throw new Error(
      'Preflight failed: Connected account must be the Runtime account, not Migrator.'
    );
  }

  const sslRows = extractRows<{ Variable_name?: string; Value?: string }>(
    await db.execute(sql`SHOW SESSION STATUS LIKE 'Ssl_cipher'`)
  );
  const tlsCipher = sslRows[0]?.Value?.trim() || null;
  const tlsActive = Boolean(tlsCipher);
  if (!tlsActive) {
    throw new Error('Preflight failed: Active TLS cipher not detected on TiDB session.');
  }

  const grantRows = extractRows<Record<string, unknown>>(
    await db.execute(sql`SHOW GRANTS FOR CURRENT_USER()`)
  );
  const grantText = grantRows
    .map((r) => Object.values(r).map(String).join(' '))
    .join('\n')
    .toUpperCase();
  const hasAll = grantText.includes('ALL PRIVILEGES');
  const hasRequiredGrants =
    hasAll ||
    (grantText.includes('SELECT') &&
      grantText.includes('INSERT') &&
      grantText.includes('UPDATE'));
  if (!hasRequiredGrants) {
    throw new Error(
      'Preflight failed: Runtime user lacks required SELECT, INSERT, UPDATE grants.'
    );
  }

  const tableRows = extractRows<Record<string, unknown>>(
    await db.execute(sql`SHOW TABLES`)
  );
  const presentTables = new Set(
    tableRows.map((row) => String(Object.values(row)[0] ?? '').trim())
  );
  const missingTables = EXPECTED_TABLES.filter((t) => !presentTables.has(t));
  if (missingTables.length > 0) {
    throw new Error(
      `Preflight failed: Missing expected tables: ${missingTables.join(', ')}`
    );
  }

  const migrationRows = extractRows<{ hash?: string }>(
    await db.execute(sql`SELECT hash FROM __drizzle_migrations ORDER BY id ASC`)
  );
  const presentHashes = new Set(
    migrationRows.map((r) => String(r.hash ?? '').trim())
  );
  const allExpectedMigrationsPresent = EXPECTED_MIGRATION_HASHES.every((h) =>
    presentHashes.has(h)
  );
  if (!allExpectedMigrationsPresent) {
    throw new Error(
      'Preflight failed: Expected migrations 0000, 0001, and 0002 are not all present in __drizzle_migrations.'
    );
  }

  const allUserRows = await db
    .select({
      id: users.id,
      email: users.email,
      platformUsername: users.platformUsername,
    })
    .from(users);

  const nonDemoUsersBefore = allUserRows.filter(
    (u) =>
      u.platformUsername !== DEMO_CONSTANTS.adminUsername &&
      u.platformUsername !== DEMO_CONSTANTS.teacherUsername &&
      u.email?.toLowerCase() !== DEMO_CONSTANTS.guardianEmail
  ).length;

  return {
    dbMode: rawMode,
    database: dbName,
    isRuntimeUser: true,
    tlsActive,
    tlsCipher,
    hasRequiredGrants,
    tableCount: presentTables.size,
    missingTables,
    migrationCount: migrationRows.length,
    allExpectedMigrationsPresent,
    nonDemoUsersBefore,
  };
}

function buildValidatedDemoContentDefinitions() {
  const items = [
    {
      slug: DEMO_CONSTANTS.contentSlugs.emotionPublished,
      contentType: 'emotion_card' as const,
      status: 'published' as const,
      title: 'Khi lòng mình thấy hồi hộp',
      summary: 'Giúp trẻ nhận diện cảm giác hồi hộp nhẹ nhàng và chọn điều giúp cơ thể thoải mái hơn.',
      locale: 'vi',
      payloadJson: {
        displayTitle: 'Khi lòng mình thấy hồi hộp',
        childText: 'Đôi khi trước một hoạt động mới, tim mình đập nhanh hơn một chút. Điều đó rất bình thường.',
        emotionKey: 'nervous',
        emotionLabel: 'Hồi hộp',
        accessibleDescription: 'Thẻ cảm xúc mô tả cảm giác tim đập nhanh và tay hơi bồn chồn khi sắp làm điều mới.',
        supportiveBodyCue: 'Bụng hơi cồn cào hoặc hai bàn tay nắm nhẹ vào nhau.',
        reflectionPrompts: [
          'Lúc này cơ thể con cảm thấy ở vùng nào rõ nhất?',
          'Con muốn thử hít thở chậm hay cầm một món đồ quen thuộc không?',
        ],
        readAloud: {
          text: 'Khi lòng mình thấy hồi hộp, tim có thể đập nhanh hơn một chút. Con có thể thở chậm hoặc nhờ người lớn ở cạnh nhé.',
          speechRateHint: 'slow',
        },
        aacSupport: {
          symbolLabel: 'Hồi hộp / Cần bình tĩnh',
          coreVocabulary: ['con thấy hồi hộp', 'cần thở chậm', 'ở cạnh con nhé'],
        },
      },
      metadataJson: {
        ageBand: '6-10',
        selThemes: ['nhan_dien_cam_xuc', 'self_awareness'],
      },
    },
    {
      slug: DEMO_CONSTANTS.contentSlugs.situationPublished,
      contentType: 'situation_card' as const,
      status: 'published' as const,
      title: 'Chờ đến lượt ở góc đồ chơi',
      summary: 'Tình huống thực hành kiên nhẫn và nói mong muốn một cách dịu dàng khi chơi cùng bạn.',
      locale: 'vi',
      payloadJson: {
        displayTitle: 'Chờ đến lượt ở góc đồ chơi',
        situationText: 'Bạn bên cạnh đang cầm bộ xếp hình mà con rất thích chơi. Giờ chơi vẫn còn thời gian.',
        narrativeContext: 'Con đứng gần bàn đồ chơi và muốn biết khi nào đến lượt của mình.',
        accessibleDescription: 'Tình huống lớp học khi hai bạn nhỏ cùng quan tâm đến một bộ xếp hình.',
        discussionPrompts: [
          'Con có thể nói câu gì thật nhẹ nhàng với bạn?',
          'Trong lúc chờ lượt, con thích làm gì cho thoải mái?',
        ],
        readAloud: {
          text: 'Bạn đang chơi bộ xếp hình mà con thích. Con có thể hỏi nhẹ nhàng: Cho mình chơi cùng hoặc chơi sau bạn nhé.',
          speechRateHint: 'slow',
        },
        aacSupport: {
          symbolLabel: 'Chờ đến lượt',
          coreVocabulary: ['đến lượt con', 'chơi cùng nhé', 'con đợi được'],
        },
      },
      metadataJson: {
        ageBand: '6-10',
        selThemes: ['giao_tiep_ban_be', 'social_awareness'],
      },
    },
    {
      slug: DEMO_CONSTANTS.contentSlugs.actionPublished,
      contentType: 'action_card' as const,
      status: 'published' as const,
      title: 'Thở chậm 3 nhịp cùng bàn tay',
      summary: 'Chiến lược hít thở nhẹ nhàng theo ngón tay giúp cơ thể lắng dịu.',
      locale: 'vi',
      payloadJson: {
        displayTitle: 'Thở chậm 3 nhịp cùng bàn tay',
        actionPhrase: 'Hít vào thật êm như ngửi hoa, thở ra chậm như thổi bong bóng xà phòng.',
        accessibleDescription: 'Hướng dẫn đặt ngón tay lên lòng bàn tay và thở chậm 3 nhịp đều đặn.',
        contextExplanation: 'Con có thể dùng cách này ở lớp hoặc ở nhà bất cứ lúc nào thấy mệt hay bồn chồn.',
        possibleOutcomes: [
          'Vai và hai bàn tay thả lỏng hơn.',
          'Nhịp thở đều hơn và dễ suy nghĩ bước tiếp theo.',
        ],
        readAloud: {
          text: 'Con giơ bàn tay lên nhẹ nhàng. Hít vào êm ái... và thở ra thật chậm. Làm cùng nhau ba nhịp nhé.',
          speechRateHint: 'slow',
        },
        aacSupport: {
          symbolLabel: 'Thở chậm',
          coreVocabulary: ['thở chậm', 'nghỉ một chút', 'con thấy dễ chịu hơn'],
        },
      },
      metadataJson: {
        ageBand: '6-10',
        selThemes: ['strategy_cat:breathing_grounding', 'tu_dieu_chinh'],
      },
    },
    {
      slug: DEMO_CONSTANTS.contentSlugs.communicationPublished,
      contentType: 'communication_card' as const,
      status: 'published' as const,
      title: 'Thẻ xin không gian yên tĩnh',
      summary: 'Thẻ giao tiếp AAC giúp trẻ bày tỏ nhu cầu tạm nghỉ ở góc yên tĩnh.',
      locale: 'vi',
      payloadJson: {
        displayTitle: 'Thẻ xin không gian yên tĩnh',
        communicationIntent: 'Xin tạm nghỉ khi âm thanh quá lớn',
        phrase: 'Con thấy hơi ồn, con xin phép ngồi ở góc yên tĩnh một lát ạ.',
        accessibleDescription: 'Thẻ giao tiếp AAC biểu thị mong muốn giảm âm thanh và nghỉ ngơi ngắn.',
        readAloud: {
          text: 'Con thấy hơi ồn, con xin phép ngồi ở góc yên tĩnh một lát ạ.',
          speechRateHint: 'slow',
        },
        aacSupport: {
          symbolLabel: 'Cần góc yên tĩnh',
          coreVocabulary: ['hơi ồn quá', 'cần yên tĩnh', 'nghỉ một lát'],
        },
      },
      metadataJson: {
        ageBand: '6-10',
        selThemes: ['strategy_cat:sensory_comfort', 'giao_tiep_aac'],
      },
    },
    {
      slug: DEMO_CONSTANTS.contentSlugs.socialStoryPublished,
      contentType: 'social_story_card' as const,
      status: 'published' as const,
      title: 'Buổi sáng dịu dàng khi vào lớp',
      summary: 'Câu chuyện xã hội 3 cảnh giúp trẻ chuẩn bị tâm thế an tâm khi bắt đầu ngày học mới.',
      locale: 'vi',
      payloadJson: {
        displayTitle: 'Buổi sáng dịu dàng khi vào lớp',
        storyIntro: 'Mỗi buổi sáng đến lớp, con luôn có thời gian làm quen thật chậm rãi.',
        scenes: [
          {
            sceneNumber: 1,
            text: 'Khi bước vào cửa lớp, con đặt ba lô vào ngăn quen thuộc và nhìn bảng lịch trình hình ảnh.',
            accessibleDescription: 'Cảnh 1: Đặt ba lô gọn gàng và xem lịch trình buổi sáng.',
            readAloud: {
              text: 'Khi bước vào lớp, con đặt ba lô vào ngăn quen thuộc và xem lịch trình hôm nay.',
              speechRateHint: 'slow',
            },
            aacSupport: {
              symbolLabel: 'Vào lớp buổi sáng',
              coreVocabulary: ['chào buổi sáng', 'xem lịch trình'],
            },
          },
          {
            sceneNumber: 2,
            text: 'Nếu trong lớp hơi rộn ràng, con có thể đeo tai nghe êm hoặc chọn góc yên tĩnh 2 phút.',
            accessibleDescription: 'Cảnh 2: Tự chọn cách làm dịu cảm giác khi lớp hơi ồn.',
            readAloud: {
              text: 'Nếu lớp hơi ồn, con có thể chọn góc yên tĩnh hai phút để thấy thoải mái hơn.',
              speechRateHint: 'slow',
            },
            aacSupport: {
              symbolLabel: 'Chọn góc yên tĩnh',
              coreVocabulary: ['con cần yên tĩnh', 'tạm nghỉ'],
            },
          },
          {
            sceneNumber: 3,
            text: 'Khi đã sẵn sàng, con vẫy tay chào cô giáo hoặc dùng thẻ giao tiếp để bắt đầu hoạt động.',
            accessibleDescription: 'Cảnh 3: Kết nối nhẹ nhàng với cô giáo bằng lời nói hoặc thẻ AAC.',
            readAloud: {
              text: 'Khi đã sẵn sàng, con chào cô giáo hoặc dùng thẻ giao tiếp để bắt đầu ngày học vui vẻ.',
              speechRateHint: 'slow',
            },
            aacSupport: {
              symbolLabel: 'Con sẵn sàng rồi',
              coreVocabulary: ['con chào cô', 'con sẵn sàng'],
            },
          },
        ],
        closingReflection: 'Con thích điều gì nhất khi mới bước vào lớp buổi sáng?',
        readAloud: {
          text: 'Câu chuyện buổi sáng dịu dàng khi vào lớp. Con luôn có thể chọn nhịp độ phù hợp với mình.',
          speechRateHint: 'slow',
        },
      },
      metadataJson: {
        ageBand: '6-10',
        selThemes: ['chuyen_tiep_an_toan', 'social_story'],
      },
    },
    {
      slug: DEMO_CONSTANTS.contentSlugs.situationPending,
      contentType: 'situation_card' as const,
      status: 'pending_review' as const,
      title: 'Khi tiếng chuông ra chơi vang to bất ngờ',
      summary: 'Thẻ tình huống đang chờ quản trị viên phê duyệt và xuất bản trong phần trình diễn.',
      locale: 'vi',
      payloadJson: {
        displayTitle: 'Khi tiếng chuông ra chơi vang to bất ngờ',
        situationText: 'Tiếng chuông báo giờ ra chơi vang lên khá to khi con đang tập trung tô màu.',
        narrativeContext: 'Con giật mình nhẹ và muốn giữ cho đôi tai dễ chịu hơn.',
        accessibleDescription: 'Tình huống giúp trẻ chọn cách tự chăm sóc thính giác hoặc báo với người lớn.',
        discussionPrompts: [
          'Con có thể che nhẹ hai tai hoặc tìm đến góc yên tĩnh nào?',
          'Nếu cần hỗ trợ, con sẽ đưa thẻ gì cho thầy cô?',
        ],
        readAloud: {
          text: 'Khi tiếng chuông vang to bất ngờ, con có thể hít thở chậm hoặc ra hiệu cho thầy cô giúp con nhé.',
          speechRateHint: 'slow',
        },
        aacSupport: {
          symbolLabel: 'Âm thanh hơi to',
          coreVocabulary: ['âm thanh to quá', 'con cần nghỉ', 'giúp con nhé'],
        },
      },
      metadataJson: {
        ageBand: '6-10',
        selThemes: ['ho_tro_giac_quan', 'tu_dieu_chinh'],
      },
    },
  ];

  // Validate every item through production SEL validator before DB writes
  return items.map((item) => {
    const titleIssues = scanUnsafeSelText(item.title, 'title');
    if (titleIssues.length > 0) {
      throw new Error(`Unsafe text in title for ${item.slug}: ${titleIssues[0].message}`);
    }
    const validated = validateContentPayloadAndMetadata({
      contentType: item.contentType,
      locale: item.locale,
      payloadJson: item.payloadJson,
      metadataJson: item.metadataJson,
    });
    return {
      ...item,
      locale: validated.locale,
      payloadJson: validated.payloadJson,
      metadataJson: validated.metadataJson,
    };
  });
}

export async function runCompetitionDemoSeed(options?: {
  resultFile?: string;
}): Promise<{
  status: 'seeded' | 'already_seeded';
  preflight: PreflightSummary;
  organizationCode: string;
  familyWorkspaceCode: string;
  countsCreated: Record<string, number>;
  verification?: Awaited<ReturnType<typeof verifyCompetitionDemoReadOnly>>;
  credentialsReturned: boolean;
}> {
  const preflight = await runPreflight();
  const db = getDb();

  // Validate formats through production validators
  validateUsernameFormat(DEMO_CONSTANTS.adminUsername, 'adminUsername');
  validateUsernameFormat(DEMO_CONSTANTS.teacherUsername, 'teacherUsername');
  validateUsernameFormat(DEMO_CONSTANTS.dualStudentUsername, 'dualStudentUsername');
  validateUsernameFormat(DEMO_CONSTANTS.familyStudentUsername, 'familyStudentUsername');
  const normalizedOrgCode = normalizeOrganizationCode(DEMO_CONSTANTS.organizationCode);

  const supportPrefs = validateSupportPreferencesJson({
    preferredCommunicationMode: 'mixed',
    aacEnabled: true,
    readAloudEnabled: true,
    speechRate: 'slow',
    visualContrast: 'standard',
    reducedMotion: true,
    preferredVisualCues: ['large_text', 'calm_colors'],
    sensoryNotes:
      'Con cảm thấy dễ chịu hơn khi giọng đọc chậm rãi và chuyển động màn hình nhẹ nhàng.',
  });

  const validatedContent = buildValidatedDemoContentDefinitions();

  // Idempotency & natural-key collision check BEFORE writing
  const [
    existingAdmin,
    existingTeacher,
    existingGuardian,
    existingOrg,
    existingWorkspace,
    existingSlugs,
    existingProgram,
  ] = await Promise.all([
    db
      .select()
      .from(users)
      .where(eq(users.platformUsername, DEMO_CONSTANTS.adminUsername))
      .limit(1),
    db
      .select()
      .from(users)
      .where(eq(users.platformUsername, DEMO_CONSTANTS.teacherUsername))
      .limit(1),
    db
      .select()
      .from(users)
      .where(eq(users.email, DEMO_CONSTANTS.guardianEmail))
      .limit(1),
    db
      .select()
      .from(organizations)
      .where(eq(organizations.code, normalizedOrgCode))
      .limit(1),
    db
      .select()
      .from(familyWorkspaces)
      .where(eq(familyWorkspaces.code, DEMO_CONSTANTS.familyWorkspaceCode))
      .limit(1),
    db
      .select({ id: contentItems.id, slug: contentItems.slug })
      .from(contentItems)
      .where(
        inArray(
          contentItems.slug,
          validatedContent.map((c) => c.slug)
        )
      ),
    db
      .select()
      .from(familyPrograms)
      .where(eq(familyPrograms.slug, DEMO_CONSTANTS.familyProgramSlug))
      .limit(1),
  ]);

  const presenceFlags = [
    existingAdmin.length > 0,
    existingTeacher.length > 0,
    existingGuardian.length > 0,
    existingOrg.length > 0,
    existingWorkspace.length > 0,
    existingSlugs.length > 0,
    existingProgram.length > 0,
  ];
  const anyPresent = presenceFlags.some(Boolean);
  const allPresent =
    existingAdmin.length > 0 &&
    existingTeacher.length > 0 &&
    existingGuardian.length > 0 &&
    existingOrg.length > 0 &&
    existingWorkspace.length > 0 &&
    existingSlugs.length === validatedContent.length &&
    existingProgram.length > 0;

  if (anyPresent && !allPresent) {
    throw new Error(
      'Collision or partial demo state detected: some demo natural keys already exist while others are missing. Aborting without modifying any records.'
    );
  }

  if (allPresent) {
    // Verify existing records are indeed the demo dataset (abort if non-demo collision)
    if (
      existingAdmin[0].platformRole !== 'platform_admin' ||
      existingAdmin[0].displayName !== DEMO_CONSTANTS.adminDisplayName ||
      existingTeacher[0].displayName !== DEMO_CONSTANTS.teacherDisplayName ||
      existingGuardian[0].platformRole !== 'guardian' ||
      existingGuardian[0].displayName !== DEMO_CONSTANTS.guardianDisplayName ||
      existingOrg[0].name !== DEMO_CONSTANTS.organizationName ||
      existingWorkspace[0].name !== DEMO_CONSTANTS.familyWorkspaceName
    ) {
      throw new Error(
        'Natural key collision with a non-demo record detected. Aborting idempotently without modifying existing data.'
      );
    }

    // Verify dual student & family-only student exist inside the demo org/workspace
    const [dualOrgMember] = await db
      .select()
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, existingOrg[0].id),
          eq(organizationMemberships.orgUsername, DEMO_CONSTANTS.dualStudentUsername)
        )
      )
      .limit(1);
    const [familyOnlyEntry] = await db
      .select()
      .from(familyStudents)
      .where(
        and(
          eq(familyStudents.familyWorkspaceId, existingWorkspace[0].id),
          eq(familyStudents.familyUsername, DEMO_CONSTANTS.familyStudentUsername)
        )
      )
      .limit(1);

    if (!dualOrgMember || !familyOnlyEntry) {
      throw new Error(
        'Existing demo org/workspace detected without expected demo student linkages. Aborting.'
      );
    }

    if (options?.resultFile) {
      fs.writeFileSync(
        options.resultFile,
        JSON.stringify(
          {
            status: 'already_seeded',
            preflight,
            organizationCode: normalizedOrgCode,
            familyWorkspaceCode: DEMO_CONSTANTS.familyWorkspaceCode,
            countsCreated: {},
            credentials: [],
          },
          null,
          2
        ),
        { mode: 0o600 }
      );
    }

    return {
      status: 'already_seeded',
      preflight,
      organizationCode: normalizedOrgCode,
      familyWorkspaceCode: DEMO_CONSTANTS.familyWorkspaceCode,
      countsCreated: {},
      credentialsReturned: false,
    };
  }

  // Generate 5 separate strong random passwords & hash with canonical scrypt
  const passwords = {
    admin: generateStrongDemoPassword(),
    teacher: generateStrongDemoPassword(),
    guardian: generateStrongDemoPassword(),
    studentDual: generateStrongDemoPassword(),
    studentFamily: generateStrongDemoPassword(),
  };

  const [
    adminHash,
    teacherHash,
    guardianHash,
    studentDualHash,
    studentFamilyHash,
  ] = await Promise.all([
    hashPassword(passwords.admin),
    hashPassword(passwords.teacher),
    hashPassword(passwords.guardian),
    hashPassword(passwords.studentDual),
    hashPassword(passwords.studentFamily),
  ]);

  const now = new Date();
  const ids = {
    adminUser: generateUuidV7(),
    teacherUser: generateUuidV7(),
    guardianUser: generateUuidV7(),
    studentDualUser: generateUuidV7(),
    studentFamilyUser: generateUuidV7(),
    org: generateUuidV7(),
    teacherMembership: generateUuidV7(),
    studentDualMembership: generateUuidV7(),
    cls: generateUuidV7(),
    classTeacher: generateUuidV7(),
    classEnrollment: generateUuidV7(),
    workspace: generateUuidV7(),
    familyMembership: generateUuidV7(),
    familyStudentDual: generateUuidV7(),
    familyStudentOnly: generateUuidV7(),
    linkDual: generateUuidV7(),
    linkFamilyOnly: generateUuidV7(),
    studentProfile: generateUuidV7(),
    studentGoal: generateUuidV7(),
    teacherObservation: generateUuidV7(),
    assignment: generateUuidV7(),
    assignmentTarget: generateUuidV7(),
    assignmentProgress: generateUuidV7(),
    familyProgram: generateUuidV7(),
    familyProgramVersion: generateUuidV7(),
    enrollmentFamilyOnly: generateUuidV7(),
    enrollmentDual: generateUuidV7(),
    studentDualPrefs: generateUuidV7(),
    studentFamilyPrefs: generateUuidV7(),
  };

  const contentMap = new Map<
    string,
    { itemId: string; versionId: string; approvalId: string; status: 'published' | 'pending_review' }
  >();

  await withTransaction(async (tx) => {
    // 1. Users (5 accounts; Demo Guardian explicitly pre-verified ONLY)
    await tx.insert(users).values([
      {
        id: ids.adminUser,
        email: null,
        emailVerifiedAt: null,
        platformUsername: DEMO_CONSTANTS.adminUsername,
        platformRole: 'platform_admin',
        displayName: DEMO_CONSTANTS.adminDisplayName,
        passwordHash: adminHash,
        passwordUpdatedAt: now,
        status: 'active',
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.teacherUser,
        email: null,
        emailVerifiedAt: null,
        platformUsername: DEMO_CONSTANTS.teacherUsername,
        platformRole: null,
        displayName: DEMO_CONSTANTS.teacherDisplayName,
        passwordHash: teacherHash,
        passwordUpdatedAt: now,
        status: 'active',
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.guardianUser,
        email: DEMO_CONSTANTS.guardianEmail,
        emailVerifiedAt: now,
        platformUsername: null,
        platformRole: 'guardian',
        displayName: DEMO_CONSTANTS.guardianDisplayName,
        passwordHash: guardianHash,
        passwordUpdatedAt: now,
        status: 'active',
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.studentDualUser,
        email: null,
        emailVerifiedAt: null,
        platformUsername: null,
        platformRole: null,
        displayName: DEMO_CONSTANTS.dualStudentDisplayName,
        passwordHash: studentDualHash,
        passwordUpdatedAt: now,
        status: 'active',
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.studentFamilyUser,
        email: null,
        emailVerifiedAt: null,
        platformUsername: null,
        platformRole: null,
        displayName: DEMO_CONSTANTS.familyStudentDisplayName,
        passwordHash: studentFamilyHash,
        passwordUpdatedAt: now,
        status: 'active',
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // 2. Organization, Memberships & Class
    await tx.insert(organizations).values({
      id: ids.org,
      code: normalizedOrgCode,
      name: DEMO_CONSTANTS.organizationName,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(organizationMemberships).values([
      {
        id: ids.teacherMembership,
        organizationId: ids.org,
        userId: ids.teacherUser,
        role: 'teacher',
        orgUsername: DEMO_CONSTANTS.teacherUsername,
        status: 'active',
        createdByUserId: ids.adminUser,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.studentDualMembership,
        organizationId: ids.org,
        userId: ids.studentDualUser,
        role: 'student',
        orgUsername: DEMO_CONSTANTS.dualStudentUsername,
        status: 'active',
        createdByUserId: ids.adminUser,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await tx.insert(classes).values({
      id: ids.cls,
      organizationId: ids.org,
      name: DEMO_CONSTANTS.className,
      academicYear: DEMO_CONSTANTS.academicYear,
      status: 'active',
      createdByUserId: ids.adminUser,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(classTeachers).values({
      id: ids.classTeacher,
      organizationId: ids.org,
      classId: ids.cls,
      teacherMembershipId: ids.teacherMembership,
      assignedByUserId: ids.adminUser,
      createdAt: now,
    });

    await tx.insert(classEnrollments).values({
      id: ids.classEnrollment,
      organizationId: ids.org,
      classId: ids.cls,
      studentMembershipId: ids.studentDualMembership,
      status: 'active',
      enrolledAt: now,
      endedAt: null,
      updatedByUserId: ids.adminUser,
    });

    // 3. Family Workspace, Membership, Family Students & Guardian Links
    await tx.insert(familyWorkspaces).values({
      id: ids.workspace,
      code: DEMO_CONSTANTS.familyWorkspaceCode,
      name: DEMO_CONSTANTS.familyWorkspaceName,
      status: 'active',
      createdByUserId: ids.guardianUser,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(familyMemberships).values({
      id: ids.familyMembership,
      familyWorkspaceId: ids.workspace,
      guardianUserId: ids.guardianUser,
      role: 'guardian',
      status: 'active',
      invitedByUserId: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(familyStudents).values([
      {
        id: ids.familyStudentDual,
        familyWorkspaceId: ids.workspace,
        studentUserId: ids.studentDualUser,
        familyUsername: DEMO_CONSTANTS.dualStudentUsername,
        status: 'active',
        createdByUserId: ids.guardianUser,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.familyStudentOnly,
        familyWorkspaceId: ids.workspace,
        studentUserId: ids.studentFamilyUser,
        familyUsername: DEMO_CONSTANTS.familyStudentUsername,
        status: 'active',
        createdByUserId: ids.guardianUser,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await tx.insert(guardianStudentLinks).values([
      {
        id: ids.linkDual,
        familyWorkspaceId: ids.workspace,
        guardianUserId: ids.guardianUser,
        studentUserId: ids.studentDualUser,
        relationshipStatus: 'active',
        verificationSource: 'school_invitation',
        sourceOrganizationId: ids.org,
        invitationId: null,
        verifiedAt: now,
        revokedAt: null,
        revokedByUserId: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.linkFamilyOnly,
        familyWorkspaceId: ids.workspace,
        guardianUserId: ids.guardianUser,
        studentUserId: ids.studentFamilyUser,
        relationshipStatus: 'active',
        verificationSource: 'family_created',
        sourceOrganizationId: null,
        invitationId: null,
        verifiedAt: now,
        revokedAt: null,
        revokedByUserId: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // 4. SEL Content (5 published baseline types + 1 pending_review item)
    for (const def of validatedContent) {
      const itemId = generateUuidV7();
      const versionId = generateUuidV7();
      const approvalId = generateUuidV7();
      contentMap.set(def.slug, {
        itemId,
        versionId,
        approvalId,
        status: def.status,
      });

      // Step 4a: insert item with currentPublishedVersionId = null (avoid circular FK cycle)
      await tx.insert(contentItems).values({
        id: itemId,
        slug: def.slug,
        contentType: def.contentType,
        currentPublishedVersionId: null,
        createdByUserId: ids.adminUser,
        isArchived: false,
        createdAt: now,
        updatedAt: now,
      });

      // Step 4b: insert version
      const isPublished = def.status === 'published';
      await tx.insert(contentVersions).values({
        id: versionId,
        contentItemId: itemId,
        versionNumber: 1,
        status: def.status,
        title: def.title,
        summary: def.summary,
        locale: def.locale,
        payloadJson: def.payloadJson,
        metadataJson: def.metadataJson,
        createdByUserId: ids.adminUser,
        publishedByUserId: isPublished ? ids.adminUser : null,
        publishedAt: isPublished ? now : null,
        createdAt: now,
        updatedAt: now,
      });

      // Step 4c: insert approval record matching service invariants
      await tx.insert(contentApprovals).values({
        id: approvalId,
        contentVersionId: versionId,
        submissionRound: 1,
        submittedByUserId: ids.adminUser,
        submittedAt: now,
        reviewerUserId: isPublished ? ids.adminUser : null,
        decision: isPublished ? 'approved' : 'pending',
        decisionNote: isPublished
          ? 'Đã kiểm tra tiêu chí an toàn SEL cho bộ dữ liệu trình diễn.'
          : null,
        isSelfApproval: isPublished,
        activeAdminCountAtDecision: isPublished ? 1 : null,
        decidedAt: isPublished ? now : null,
      });

      // Step 4d: point item's currentPublishedVersionId to published version
      if (isPublished) {
        await tx
          .update(contentItems)
          .set({ currentPublishedVersionId: versionId, updatedAt: now })
          .where(eq(contentItems.id, itemId));
      }
    }

    // 5. Teacher Demonstration Data (Support Profile, Goal, Private Observation, Assignment)
    await tx.insert(studentProfiles).values({
      id: ids.studentProfile,
      organizationId: ids.org,
      studentMembershipId: ids.studentDualMembership,
      preferredName: 'Bé Minh Anh',
      supportPreferencesJson: supportPrefs,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(studentGoals).values({
      id: ids.studentGoal,
      organizationId: ids.org,
      studentMembershipId: ids.studentDualMembership,
      classId: ids.cls,
      createdByTeacherMembershipId: ids.teacherMembership,
      title: 'Thực hành xin tạm nghỉ bằng thẻ AAC khi lớp ồn',
      description:
        'Con có thể chủ động chọn thẻ giao tiếp hoặc nhịp thở chậm bất cứ khi nào thấy âm thanh xung quanh hơi lớn.',
      focusArea: 'Giao tiếp & Tự điều chỉnh cảm xúc',
      status: 'active',
      targetDate: null,
      achievedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(teacherObservations).values({
      id: ids.teacherObservation,
      organizationId: ids.org,
      authorTeacherMembershipId: ids.teacherMembership,
      studentMembershipId: ids.studentDualMembership,
      classId: ids.cls,
      assignmentId: null,
      attemptId: null,
      noteBody:
        '[Ghi chú sư phạm riêng tư - Demo] Trong giờ làm quen thẻ cảm xúc, Minh Anh thích đọc to với tốc độ chậm và chọn góc ngồi yên tĩnh gần cửa sổ.',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    // School Assignment targeting Dual-Context Student using published SEL items
    const schoolItemVersionIds = [
      contentMap.get(DEMO_CONSTANTS.contentSlugs.situationPublished)!.versionId,
      contentMap.get(DEMO_CONSTANTS.contentSlugs.actionPublished)!.versionId,
      contentMap.get(DEMO_CONSTANTS.contentSlugs.communicationPublished)!.versionId,
    ];

    await tx.insert(assignments).values({
      id: ids.assignment,
      organizationId: ids.org,
      classId: ids.cls,
      createdByTeacherMembershipId: ids.teacherMembership,
      title: DEMO_CONSTANTS.assignmentTitle,
      homePracticeInstructions:
        'Ba mẹ có thể cùng con xem lại thẻ tình huống và tập thở chậm 3 nhịp vào buổi tối nếu con cảm thấy thoải mái.',
      dueAt: null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(assignmentItems).values(
      schoolItemVersionIds.map((versionId, idx) => ({
        id: generateUuidV7(),
        organizationId: ids.org,
        assignmentId: ids.assignment,
        contentVersionId: versionId,
        sortOrder: idx,
        createdAt: now,
      }))
    );

    await tx.insert(assignmentTargets).values({
      id: ids.assignmentTarget,
      organizationId: ids.org,
      assignmentId: ids.assignment,
      studentMembershipId: ids.studentDualMembership,
      assignedAt: now,
    });

    await tx.insert(assignmentProgress).values({
      id: ids.assignmentProgress,
      organizationId: ids.org,
      assignmentTargetId: ids.assignmentTarget,
      studentMembershipId: ids.studentDualMembership,
      activeAttemptId: null,
      latestCompletedAttemptId: null,
      totalItems: schoolItemVersionIds.length,
      completedItems: 0,
      attemptCount: 0,
      status: 'not_started',
      lastActivityAt: null,
      completedAt: null,
      updatedAt: now,
    });

    // 6. Family Learning Program (published free_family) + Enrollments (no fake attempts)
    await tx.insert(familyPrograms).values({
      id: ids.familyProgram,
      slug: DEMO_CONSTANTS.familyProgramSlug,
      availabilityMode: 'free_family',
      status: 'published',
      currentPublishedVersionId: null,
      createdByUserId: ids.adminUser,
      retiredAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(familyProgramVersions).values({
      id: ids.familyProgramVersion,
      familyProgramId: ids.familyProgram,
      versionNumber: 1,
      status: 'published',
      title: DEMO_CONSTANTS.familyProgramTitle,
      description:
        'Chương trình thực hành SEL tại nhà theo nhịp độ riêng của trẻ, không cần kết nối lớp học hay giáo viên.',
      locale: 'vi',
      ageBand: '6-10',
      availabilityMode: 'free_family',
      createdByUserId: ids.adminUser,
      publishedByUserId: ids.adminUser,
      publishedAt: now,
      retiredAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await tx
      .update(familyPrograms)
      .set({
        currentPublishedVersionId: ids.familyProgramVersion,
        updatedAt: now,
      })
      .where(eq(familyPrograms.id, ids.familyProgram));

    const familyProgramEntries = [
      {
        chapterNumber: 1,
        chapterTitle: 'Chương 1: Nhận biết cảm xúc nhẹ nhàng',
        contentVersionId: contentMap.get(
          DEMO_CONSTANTS.contentSlugs.emotionPublished
        )!.versionId,
      },
      {
        chapterNumber: 1,
        chapterTitle: 'Chương 1: Nhận biết cảm xúc nhẹ nhàng',
        contentVersionId: contentMap.get(
          DEMO_CONSTANTS.contentSlugs.socialStoryPublished
        )!.versionId,
      },
      {
        chapterNumber: 2,
        chapterTitle: 'Chương 2: Thở chậm và chọn cách thoải mái',
        contentVersionId: contentMap.get(
          DEMO_CONSTANTS.contentSlugs.actionPublished
        )!.versionId,
      },
    ];

    await tx.insert(familyProgramItems).values(
      familyProgramEntries.map((entry, idx) => ({
        id: generateUuidV7(),
        familyProgramVersionId: ids.familyProgramVersion,
        chapterNumber: entry.chapterNumber,
        chapterTitle: entry.chapterTitle,
        sortOrder: idx,
        contentVersionId: entry.contentVersionId,
        createdAt: now,
      }))
    );

    await tx.insert(familyProgramEnrollments).values([
      {
        id: ids.enrollmentFamilyOnly,
        familyWorkspaceId: ids.workspace,
        studentUserId: ids.studentFamilyUser,
        familyProgramId: ids.familyProgram,
        familyProgramVersionId: ids.familyProgramVersion,
        activationSource: 'guardian_free',
        activatedByUserId: ids.guardianUser,
        status: 'active',
        learningStatus: 'not_started',
        totalActivities: familyProgramEntries.length,
        completedActivities: 0,
        startedAt: null,
        lastActivityAt: null,
        completedAt: null,
        activatedAt: now,
        revokedAt: null,
        revokedByUserId: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.enrollmentDual,
        familyWorkspaceId: ids.workspace,
        studentUserId: ids.studentDualUser,
        familyProgramId: ids.familyProgram,
        familyProgramVersionId: ids.familyProgramVersion,
        activationSource: 'guardian_free',
        activatedByUserId: ids.guardianUser,
        status: 'active',
        learningStatus: 'not_started',
        totalActivities: familyProgramEntries.length,
        completedActivities: 0,
        startedAt: null,
        lastActivityAt: null,
        completedAt: null,
        activatedAt: now,
        revokedAt: null,
        revokedByUserId: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // 7. Student family comfort preferences (persisted cleanly without org dependency)
    await tx.insert(studentFamilyPreferences).values([
      {
        id: ids.studentDualPrefs,
        studentUserId: ids.studentDualUser,
        preferredName: 'Bé Minh Anh',
        supportPreferencesJson: supportPrefs,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.studentFamilyPrefs,
        studentUserId: ids.studentFamilyUser,
        preferredName: 'Bé Bảo An',
        supportPreferencesJson: {
          aacEnabled: true,
          readAloudEnabled: true,
          speechRate: 'slow',
          visualContrast: 'standard',
          reducedMotion: false,
        },
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // 8. Append-only audit trail entry marking controlled provisioning (zero credentials)
    await tx.insert(auditLogs).values({
      id: generateUuidV7(),
      organizationId: ids.org,
      actorUserId: ids.adminUser,
      actorRole: 'platform_admin',
      eventType: 'account.created',
      targetType: 'organization',
      targetId: ids.org,
      ipPrefix: 'internal-seed',
      metadataJson: {
        seedPhase: 'P4-DEMO-01',
        organizationCode: normalizedOrgCode,
        familyWorkspaceCode: DEMO_CONSTANTS.familyWorkspaceCode,
        demoAccountsProvisioned: 5,
      },
      createdAt: now,
    });
  });

  const countsCreated = {
    users: 5,
    organizations: 1,
    organization_memberships: 2,
    classes: 1,
    class_teachers: 1,
    class_enrollments: 1,
    family_workspaces: 1,
    family_memberships: 1,
    family_students: 2,
    guardian_student_links: 2,
    content_items: validatedContent.length,
    content_versions: validatedContent.length,
    content_approvals: validatedContent.length,
    student_profiles: 1,
    student_goals: 1,
    teacher_observations: 1,
    assignments: 1,
    assignment_items: 3,
    assignment_targets: 1,
    assignment_progress: 1,
    family_programs: 1,
    family_program_versions: 1,
    family_program_items: 3,
    family_program_enrollments: 2,
    student_family_preferences: 2,
    audit_logs: 1,
  };

  const credentials: GeneratedCredentialEntry[] = [
    {
      role: 'platform_admin',
      displayName: DEMO_CONSTANTS.adminDisplayName,
      loginMode: 'admin_teacher',
      identifierLabel: 'platformUsername',
      identifier: DEMO_CONSTANTS.adminUsername,
      organizationOrWorkspaceCode: null,
      password: passwords.admin,
    },
    {
      role: 'teacher',
      displayName: DEMO_CONSTANTS.teacherDisplayName,
      loginMode: 'admin_teacher',
      identifierLabel: 'platformUsername',
      identifier: DEMO_CONSTANTS.teacherUsername,
      organizationOrWorkspaceCode: normalizedOrgCode,
      password: passwords.teacher,
    },
    {
      role: 'guardian',
      displayName: DEMO_CONSTANTS.guardianDisplayName,
      loginMode: 'guardian',
      identifierLabel: 'email',
      identifier: DEMO_CONSTANTS.guardianEmail,
      organizationOrWorkspaceCode: null,
      password: passwords.guardian,
    },
    {
      role: 'student_dual',
      displayName: DEMO_CONSTANTS.dualStudentDisplayName,
      loginMode: 'student',
      identifierLabel: 'orgUsername / familyUsername',
      identifier: DEMO_CONSTANTS.dualStudentUsername,
      organizationOrWorkspaceCode: `${normalizedOrgCode} (School) / ${DEMO_CONSTANTS.familyWorkspaceCode} (Family)`,
      password: passwords.studentDual,
    },
    {
      role: 'student_family',
      displayName: DEMO_CONSTANTS.familyStudentDisplayName,
      loginMode: 'student',
      identifierLabel: 'familyUsername',
      identifier: DEMO_CONSTANTS.familyStudentUsername,
      organizationOrWorkspaceCode: DEMO_CONSTANTS.familyWorkspaceCode,
      password: passwords.studentFamily,
    },
  ];

  const verification = await verifyCompetitionDemoReadOnly(preflight.nonDemoUsersBefore);

  if (options?.resultFile) {
    fs.writeFileSync(
      options.resultFile,
      JSON.stringify(
        {
          status: 'seeded',
          preflight,
          organizationCode: normalizedOrgCode,
          familyWorkspaceCode: DEMO_CONSTANTS.familyWorkspaceCode,
          countsCreated,
          verification,
          credentials,
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
  }

  return {
    status: 'seeded',
    preflight,
    organizationCode: normalizedOrgCode,
    familyWorkspaceCode: DEMO_CONSTANTS.familyWorkspaceCode,
    countsCreated,
    verification,
    credentialsReturned: true,
  };
}

export async function verifyCompetitionDemoReadOnly(expectedNonDemoUsersCount?: number) {
  const db = getDb();

  const [admin] = await db
    .select({
      id: users.id,
      platformRole: users.platformRole,
      status: users.status,
      displayName: users.displayName,
    })
    .from(users)
    .where(eq(users.platformUsername, DEMO_CONSTANTS.adminUsername))
    .limit(1);

  const [teacher] = await db
    .select({
      id: users.id,
      platformRole: users.platformRole,
      status: users.status,
      displayName: users.displayName,
    })
    .from(users)
    .where(eq(users.platformUsername, DEMO_CONSTANTS.teacherUsername))
    .limit(1);

  const [guardian] = await db
    .select({
      id: users.id,
      platformRole: users.platformRole,
      emailVerifiedAt: users.emailVerifiedAt,
      status: users.status,
      displayName: users.displayName,
    })
    .from(users)
    .where(eq(users.email, DEMO_CONSTANTS.guardianEmail))
    .limit(1);

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.code, DEMO_CONSTANTS.organizationCode))
    .limit(1);

  const [ws] = await db
    .select()
    .from(familyWorkspaces)
    .where(eq(familyWorkspaces.code, DEMO_CONSTANTS.familyWorkspaceCode))
    .limit(1);

  const [dualSchoolMem] = org
    ? await db
        .select()
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, org.id),
            eq(organizationMemberships.orgUsername, DEMO_CONSTANTS.dualStudentUsername)
          )
        )
        .limit(1)
    : [];

  const [dualFamilyRec] = ws
    ? await db
        .select()
        .from(familyStudents)
        .where(
          and(
            eq(familyStudents.familyWorkspaceId, ws.id),
            eq(familyStudents.familyUsername, DEMO_CONSTANTS.dualStudentUsername)
          )
        )
        .limit(1)
    : [];

  const [familyOnlyRec] = ws
    ? await db
        .select()
        .from(familyStudents)
        .where(
          and(
            eq(familyStudents.familyWorkspaceId, ws.id),
            eq(familyStudents.familyUsername, DEMO_CONSTANTS.familyStudentUsername)
          )
        )
        .limit(1)
    : [];

  const familyOnlyOrgMemberships = familyOnlyRec
    ? await db
        .select({ id: organizationMemberships.id })
        .from(organizationMemberships)
        .where(eq(organizationMemberships.userId, familyOnlyRec.studentUserId))
    : [];

  const guardianLinks = guardian
    ? await db
        .select({
          studentUserId: guardianStudentLinks.studentUserId,
          relationshipStatus: guardianStudentLinks.relationshipStatus,
        })
        .from(guardianStudentLinks)
        .where(eq(guardianStudentLinks.guardianUserId, guardian.id))
    : [];

  const contentRows = await db
    .select({
      slug: contentItems.slug,
      contentType: contentItems.contentType,
      currentPublishedVersionId: contentItems.currentPublishedVersionId,
      versionStatus: contentVersions.status,
    })
    .from(contentItems)
    .innerJoin(contentVersions, eq(contentVersions.contentItemId, contentItems.id))
    .where(
      inArray(
        contentItems.slug,
        Object.values(DEMO_CONSTANTS.contentSlugs)
      )
    );

  const [programRow] = await db
    .select()
    .from(familyPrograms)
    .where(eq(familyPrograms.slug, DEMO_CONSTANTS.familyProgramSlug))
    .limit(1);

  const enrollments = programRow
    ? await db
        .select({
          studentUserId: familyProgramEnrollments.studentUserId,
          status: familyProgramEnrollments.status,
          learningStatus: familyProgramEnrollments.learningStatus,
        })
        .from(familyProgramEnrollments)
        .where(eq(familyProgramEnrollments.familyProgramId, programRow.id))
    : [];

  const [assignmentRow] = org
    ? await db
        .select()
        .from(assignments)
        .where(
          and(
            eq(assignments.organizationId, org.id),
            eq(assignments.title, DEMO_CONSTANTS.assignmentTitle)
          )
        )
        .limit(1)
    : [];

  // Verify non-demo user(s) remain untouched and unverified if previously unverified
  const nonDemoRows = await db
    .select({
      id: users.id,
      emailVerifiedAt: users.emailVerifiedAt,
      platformRole: users.platformRole,
    })
    .from(users);
  const demoUserIds = new Set(
    [
      admin?.id,
      teacher?.id,
      guardian?.id,
      dualSchoolMem?.userId,
      familyOnlyRec?.studentUserId,
    ].filter((x): x is string => Boolean(x))
  );
  const nonDemoUsersAfter = nonDemoRows.filter((u) => !demoUserIds.has(u.id));

  const publishedTypes = new Set(
    contentRows
      .filter(
        (r) =>
          r.versionStatus === 'published' &&
          r.currentPublishedVersionId !== null
      )
      .map((r) => r.contentType)
  );
  const pendingItem = contentRows.find(
    (r) => r.slug === DEMO_CONSTANTS.contentSlugs.situationPending
  );

  return {
    allFiveDemoAccountsActive: Boolean(
      admin?.status === 'active' &&
        teacher?.status === 'active' &&
        guardian?.status === 'active' &&
        dualSchoolMem &&
        familyOnlyRec
    ),
    demoGuardianVerified: Boolean(guardian?.emailVerifiedAt),
    nonDemoUsersCountAfter: nonDemoUsersAfter.length,
    nonDemoUsersUnchanged:
      expectedNonDemoUsersCount === undefined
        ? true
        : nonDemoUsersAfter.length === expectedNonDemoUsersCount &&
          nonDemoUsersAfter.every((u) => u.emailVerifiedAt === null),
    dualStudentCanonicalSingleUserId: Boolean(
      dualSchoolMem?.userId &&
        dualFamilyRec?.studentUserId &&
        dualSchoolMem.userId === dualFamilyRec.studentUserId
    ),
    familyOnlyStudentZeroOrgMemberships:
      Boolean(familyOnlyRec) && familyOnlyOrgMemberships.length === 0,
    guardianLinksCount: guardianLinks.length,
    guardianLinksExactTwoDemoStudents:
      guardianLinks.length === 2 &&
      guardianLinks.every((l) => l.relationshipStatus === 'active') &&
      guardianLinks.some((l) => l.studentUserId === dualSchoolMem?.userId) &&
      guardianLinks.some((l) => l.studentUserId === familyOnlyRec?.studentUserId),
    publishedCanonicalTypesCount: publishedTypes.size,
    pendingReviewItemStatus: pendingItem?.versionStatus ?? null,
    familyProgramPublished: programRow?.status === 'published',
    familyProgramActiveEnrollments: enrollments.filter((e) => e.status === 'active').length,
    schoolAssignmentActive: assignmentRow?.status === 'active',
  };
}

async function main() {
  const { resultFile } = parseArgs(process.argv.slice(2));
  try {
    const summary = await runCompetitionDemoSeed({ resultFile });
    // Safe non-secret stdout summary ONLY (zero passwords)
    console.log(JSON.stringify(summary));
    process.exitCode = 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown seed failure';
    console.error(`[seed-competition-demo] FAILED: ${message}`);
    process.exitCode = 1;
  } finally {
    await closeTiDbPool().catch(() => undefined);
  }
}

const isDirectEntry =
  typeof process.argv[1] === 'string' &&
  process.argv[1].endsWith('seed-competition-demo.ts');

if (isDirectEntry) {
  void main();
}
