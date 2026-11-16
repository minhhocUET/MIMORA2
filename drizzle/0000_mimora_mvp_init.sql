CREATE TABLE `organization_memberships` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`organization_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`role` varchar(32) NOT NULL,
	`org_username` varchar(64) CHARACTER SET ascii COLLATE ascii_bin,
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`created_by_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `organization_memberships_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_org_memberships_org_id` UNIQUE(`organization_id`,`id`),
	CONSTRAINT `uq_org_memberships_org_user` UNIQUE(`organization_id`,`user_id`),
	CONSTRAINT `uq_org_memberships_org_username` UNIQUE(`organization_id`,`org_username`)
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`code` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`name` varchar(255) NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `organizations_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_organizations_code` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`session_scope` varchar(32) NOT NULL,
	`active_organization_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`idle_expires_at` datetime(3) NOT NULL,
	`absolute_expires_at` datetime(3) NOT NULL,
	`last_activity_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	`revoked_reason` varchar(64),
	`ip_prefix` varchar(64),
	`user_agent_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_sessions_token_hash` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci,
	`platform_username` varchar(64) CHARACTER SET ascii COLLATE ascii_bin,
	`platform_role` varchar(32),
	`display_name` varchar(255) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`password_updated_at` datetime(3) NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`failed_login_attempts` int NOT NULL DEFAULT 0,
	`locked_until` datetime(3),
	`last_login_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_users_email` UNIQUE(`email`),
	CONSTRAINT `uq_users_platform_username` UNIQUE(`platform_username`)
);
--> statement-breakpoint
CREATE TABLE `class_enrollments` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`organization_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`class_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`student_membership_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`enrolled_at` datetime(3) NOT NULL,
	`ended_at` datetime(3),
	`updated_by_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`active_class_guard` char(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN status = 'active' THEN class_id ELSE NULL END) VIRTUAL,
	`active_student_guard` char(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN status = 'active' THEN student_membership_id ELSE NULL END) VIRTUAL,
	CONSTRAINT `class_enrollments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_class_enrollments_active_pair` UNIQUE(`active_class_guard`,`active_student_guard`)
);
--> statement-breakpoint
CREATE TABLE `class_teachers` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`organization_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`class_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`teacher_membership_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`assigned_by_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `class_teachers_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_class_teachers_pair` UNIQUE(`class_id`,`teacher_membership_id`)
);
--> statement-breakpoint
CREATE TABLE `classes` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`organization_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`name` varchar(255) NOT NULL,
	`academic_year` varchar(32),
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`created_by_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `classes_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_classes_org_id` UNIQUE(`organization_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `csv_import_jobs` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`organization_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`uploaded_by_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`target_class_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`source_filename` varchar(255) NOT NULL,
	`status` varchar(32) NOT NULL,
	`total_rows` int NOT NULL DEFAULT 0,
	`succeeded_rows` int NOT NULL DEFAULT 0,
	`failed_rows` int NOT NULL DEFAULT 0,
	`error_summary_json` json,
	`created_at` datetime(3) NOT NULL,
	`completed_at` datetime(3),
	CONSTRAINT `csv_import_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `student_goals` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`organization_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`student_membership_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`class_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`created_by_teacher_membership_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`focus_area` varchar(64),
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`target_date` date,
	`achieved_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `student_goals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `student_profiles` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`organization_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`student_membership_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`preferred_name` varchar(255),
	`support_preferences_json` json,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `student_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_student_profiles_member` UNIQUE(`organization_id`,`student_membership_id`)
);
--> statement-breakpoint
CREATE TABLE `content_approvals` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`content_version_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`submission_round` int NOT NULL DEFAULT 1,
	`submitted_by_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`submitted_at` datetime(3) NOT NULL,
	`reviewer_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`decision` varchar(32) NOT NULL DEFAULT 'pending',
	`decision_note` text,
	`is_self_approval` boolean NOT NULL DEFAULT false,
	`active_admin_count_at_decision` int,
	`decided_at` datetime(3),
	`pending_version_guard` char(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN decision = 'pending' THEN content_version_id ELSE NULL END) VIRTUAL,
	CONSTRAINT `content_approvals_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_approvals_version_round` UNIQUE(`content_version_id`,`submission_round`),
	CONSTRAINT `uq_approvals_single_pending` UNIQUE(`pending_version_guard`)
);
--> statement-breakpoint
CREATE TABLE `content_items` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`slug` varchar(128) NOT NULL,
	`content_type` varchar(32) NOT NULL,
	`current_published_version_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`created_by_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`is_archived` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `content_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_content_items_slug` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `content_versions` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`content_item_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`version_number` int NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'draft',
	`title` varchar(255) NOT NULL,
	`summary` text,
	`locale` varchar(16) NOT NULL DEFAULT 'vi',
	`payload_json` json NOT NULL,
	`metadata_json` json,
	`created_by_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`published_by_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`published_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `content_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_content_versions_item_num` UNIQUE(`content_item_id`,`version_number`),
	CONSTRAINT `uq_content_versions_item_id` UNIQUE(`content_item_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `activity_attempt_turns` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`organization_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`attempt_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`turn_index` int NOT NULL,
	`step_key` varchar(64) NOT NULL,
	`selected_choice_key` varchar(128),
	`selected_emotion_key` varchar(64),
	`used_aac` boolean NOT NULL DEFAULT false,
	`used_read_aloud` boolean NOT NULL DEFAULT false,
	`response_payload_json` json,
	`responded_at` datetime(3) NOT NULL,
	CONSTRAINT `activity_attempt_turns_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_turns_attempt_idx` UNIQUE(`attempt_id`,`turn_index`)
);
--> statement-breakpoint
CREATE TABLE `activity_attempts` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`organization_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`assignment_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`assignment_target_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`assignment_item_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`student_membership_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`content_version_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`attempt_number` int NOT NULL,
	`start_idempotency_key` varchar(64),
	`status` varchar(32) NOT NULL DEFAULT 'in_progress',
	`started_at` datetime(3) NOT NULL,
	`last_interacted_at` datetime(3) NOT NULL,
	`completed_at` datetime(3),
	`duration_seconds` int NOT NULL DEFAULT 0,
	`used_aac_support` boolean NOT NULL DEFAULT false,
	`used_read_aloud` boolean NOT NULL DEFAULT false,
	`aac_tap_count` int NOT NULL DEFAULT 0,
	`read_aloud_count` int NOT NULL DEFAULT 0,
	`response_summary_json` json,
	`in_progress_target_guard` char(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN status = 'in_progress' THEN assignment_target_id ELSE NULL END) VIRTUAL,
	`in_progress_item_guard` char(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN status = 'in_progress' THEN assignment_item_id ELSE NULL END) VIRTUAL,
	CONSTRAINT `activity_attempts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_attempts_org_id` UNIQUE(`organization_id`,`id`),
	CONSTRAINT `uq_attempts_org_student_id` UNIQUE(`organization_id`,`student_membership_id`,`id`),
	CONSTRAINT `uq_attempts_org_assign_student_id` UNIQUE(`organization_id`,`assignment_id`,`student_membership_id`,`id`),
	CONSTRAINT `uq_attempts_org_target_student_id` UNIQUE(`organization_id`,`assignment_target_id`,`student_membership_id`,`id`),
	CONSTRAINT `uq_attempts_number` UNIQUE(`assignment_target_id`,`assignment_item_id`,`attempt_number`),
	CONSTRAINT `uq_attempts_idempotency` UNIQUE(`assignment_target_id`,`assignment_item_id`,`start_idempotency_key`),
	CONSTRAINT `uq_attempts_single_in_progress` UNIQUE(`in_progress_target_guard`,`in_progress_item_guard`)
);
--> statement-breakpoint
CREATE TABLE `assignment_items` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`organization_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`assignment_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`content_version_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `assignment_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_assignment_items_org_id` UNIQUE(`organization_id`,`id`),
	CONSTRAINT `uq_assignment_items_org_assign_ver_id` UNIQUE(`organization_id`,`assignment_id`,`content_version_id`,`id`),
	CONSTRAINT `uq_assignment_items_order` UNIQUE(`assignment_id`,`sort_order`)
);
--> statement-breakpoint
CREATE TABLE `assignment_progress` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`organization_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`assignment_target_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`student_membership_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`active_attempt_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`latest_completed_attempt_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`total_items` int NOT NULL,
	`completed_items` int NOT NULL DEFAULT 0,
	`attempt_count` int NOT NULL DEFAULT 0,
	`status` varchar(32) NOT NULL DEFAULT 'not_started',
	`last_activity_at` datetime(3),
	`completed_at` datetime(3),
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `assignment_progress_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_progress_target` UNIQUE(`organization_id`,`assignment_target_id`)
);
--> statement-breakpoint
CREATE TABLE `assignment_targets` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`organization_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`assignment_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`student_membership_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`assigned_at` datetime(3) NOT NULL,
	CONSTRAINT `assignment_targets_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_targets_org_id` UNIQUE(`organization_id`,`id`),
	CONSTRAINT `uq_targets_assignment_student` UNIQUE(`assignment_id`,`student_membership_id`),
	CONSTRAINT `uq_targets_org_student_id` UNIQUE(`organization_id`,`student_membership_id`,`id`),
	CONSTRAINT `uq_targets_org_assign_student_id` UNIQUE(`organization_id`,`assignment_id`,`student_membership_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `assignments` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`organization_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`class_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`created_by_teacher_membership_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`title` varchar(255) NOT NULL,
	`home_practice_instructions` text,
	`due_at` datetime(3),
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `assignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_assignments_org_id` UNIQUE(`organization_id`,`id`),
	CONSTRAINT `uq_assignments_org_class_id` UNIQUE(`organization_id`,`class_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `teacher_observations` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`organization_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`author_teacher_membership_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`student_membership_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`class_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`assignment_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`attempt_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`note_body` text NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`deleted_at` datetime(3),
	CONSTRAINT `teacher_observations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `org_insight_daily_snapshots` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`organization_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`period_type` varchar(16) NOT NULL DEFAULT 'daily',
	`snapshot_date` date NOT NULL,
	`content_type` varchar(32) NOT NULL,
	`eligible_enrolled_students_count` int NOT NULL DEFAULT 0,
	`active_students_count` int NOT NULL DEFAULT 0,
	`attempts_started_count` int NOT NULL DEFAULT 0,
	`attempts_completed_count` int NOT NULL DEFAULT 0,
	`distinct_content_used_count` int NOT NULL DEFAULT 0,
	`aac_assisted_attempts_count` int NOT NULL DEFAULT 0,
	`read_aloud_assisted_attempts_count` int NOT NULL DEFAULT 0,
	`active_goals_count` int NOT NULL DEFAULT 0,
	`achieved_goals_count` int NOT NULL DEFAULT 0,
	`choice_trends_summary_json` json,
	`computed_at` datetime(3) NOT NULL,
	CONSTRAINT `org_insight_daily_snapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_org_insights_period` UNIQUE(`organization_id`,`period_type`,`snapshot_date`,`content_type`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`organization_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`actor_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`actor_role` varchar(32),
	`event_type` varchar(64) NOT NULL,
	`target_type` varchar(64),
	`target_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`ip_prefix` varchar(64),
	`metadata_json` json,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `organization_memberships` ADD CONSTRAINT `fk_org_memberships_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `organization_memberships` ADD CONSTRAINT `fk_org_memberships_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `organization_memberships` ADD CONSTRAINT `fk_org_memberships_creator` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `fk_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `fk_sessions_active_org_membership` FOREIGN KEY (`active_organization_id`,`user_id`) REFERENCES `organization_memberships`(`organization_id`,`user_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `class_enrollments` ADD CONSTRAINT `fk_enrollments_class` FOREIGN KEY (`organization_id`,`class_id`) REFERENCES `classes`(`organization_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `class_enrollments` ADD CONSTRAINT `fk_enrollments_student` FOREIGN KEY (`organization_id`,`student_membership_id`) REFERENCES `organization_memberships`(`organization_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `class_enrollments` ADD CONSTRAINT `fk_enrollments_actor` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `class_teachers` ADD CONSTRAINT `fk_class_teachers_class` FOREIGN KEY (`organization_id`,`class_id`) REFERENCES `classes`(`organization_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `class_teachers` ADD CONSTRAINT `fk_class_teachers_member` FOREIGN KEY (`organization_id`,`teacher_membership_id`) REFERENCES `organization_memberships`(`organization_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `class_teachers` ADD CONSTRAINT `fk_class_teachers_assigned_by` FOREIGN KEY (`assigned_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `classes` ADD CONSTRAINT `fk_classes_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `classes` ADD CONSTRAINT `fk_classes_creator` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `csv_import_jobs` ADD CONSTRAINT `fk_csv_jobs_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `csv_import_jobs` ADD CONSTRAINT `fk_csv_jobs_uploader` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `csv_import_jobs` ADD CONSTRAINT `fk_csv_jobs_class` FOREIGN KEY (`organization_id`,`target_class_id`) REFERENCES `classes`(`organization_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `student_goals` ADD CONSTRAINT `fk_goals_student` FOREIGN KEY (`organization_id`,`student_membership_id`) REFERENCES `organization_memberships`(`organization_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `student_goals` ADD CONSTRAINT `fk_goals_teacher` FOREIGN KEY (`organization_id`,`created_by_teacher_membership_id`) REFERENCES `organization_memberships`(`organization_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `student_goals` ADD CONSTRAINT `fk_goals_class` FOREIGN KEY (`organization_id`,`class_id`) REFERENCES `classes`(`organization_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `student_profiles` ADD CONSTRAINT `fk_student_profiles_member` FOREIGN KEY (`organization_id`,`student_membership_id`) REFERENCES `organization_memberships`(`organization_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `content_approvals` ADD CONSTRAINT `fk_approvals_version` FOREIGN KEY (`content_version_id`) REFERENCES `content_versions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `content_approvals` ADD CONSTRAINT `fk_approvals_submitter` FOREIGN KEY (`submitted_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `content_approvals` ADD CONSTRAINT `fk_approvals_reviewer` FOREIGN KEY (`reviewer_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `content_items` ADD CONSTRAINT `fk_content_items_creator` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `content_items` ADD CONSTRAINT `fk_content_items_pub_version` FOREIGN KEY (`id`,`current_published_version_id`) REFERENCES `content_versions`(`content_item_id`,`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `content_versions` ADD CONSTRAINT `fk_content_versions_item` FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `content_versions` ADD CONSTRAINT `fk_content_versions_creator` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `content_versions` ADD CONSTRAINT `fk_content_versions_publisher` FOREIGN KEY (`published_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_attempt_turns` ADD CONSTRAINT `fk_turns_attempt` FOREIGN KEY (`organization_id`,`attempt_id`) REFERENCES `activity_attempts`(`organization_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_attempts` ADD CONSTRAINT `fk_attempts_target` FOREIGN KEY (`organization_id`,`assignment_id`,`student_membership_id`,`assignment_target_id`) REFERENCES `assignment_targets`(`organization_id`,`assignment_id`,`student_membership_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_attempts` ADD CONSTRAINT `fk_attempts_item` FOREIGN KEY (`organization_id`,`assignment_id`,`content_version_id`,`assignment_item_id`) REFERENCES `assignment_items`(`organization_id`,`assignment_id`,`content_version_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_attempts` ADD CONSTRAINT `fk_attempts_student` FOREIGN KEY (`organization_id`,`student_membership_id`) REFERENCES `organization_memberships`(`organization_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_attempts` ADD CONSTRAINT `fk_attempts_version` FOREIGN KEY (`content_version_id`) REFERENCES `content_versions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assignment_items` ADD CONSTRAINT `fk_assignment_items_assignment` FOREIGN KEY (`organization_id`,`assignment_id`) REFERENCES `assignments`(`organization_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assignment_items` ADD CONSTRAINT `fk_assignment_items_version` FOREIGN KEY (`content_version_id`) REFERENCES `content_versions`(`id`) ON DELETE no action ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `assignment_progress` ADD CONSTRAINT `fk_progress_target` FOREIGN KEY (`organization_id`,`student_membership_id`,`assignment_target_id`) REFERENCES `assignment_targets`(`organization_id`,`student_membership_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assignment_progress` ADD CONSTRAINT `fk_progress_active_attempt` FOREIGN KEY (`organization_id`,`assignment_target_id`,`student_membership_id`,`active_attempt_id`) REFERENCES `activity_attempts`(`organization_id`,`assignment_target_id`,`student_membership_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assignment_progress` ADD CONSTRAINT `fk_progress_completed_attempt` FOREIGN KEY (`organization_id`,`assignment_target_id`,`student_membership_id`,`latest_completed_attempt_id`) REFERENCES `activity_attempts`(`organization_id`,`assignment_target_id`,`student_membership_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assignment_targets` ADD CONSTRAINT `fk_targets_assignment` FOREIGN KEY (`organization_id`,`assignment_id`) REFERENCES `assignments`(`organization_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assignment_targets` ADD CONSTRAINT `fk_targets_student` FOREIGN KEY (`organization_id`,`student_membership_id`) REFERENCES `organization_memberships`(`organization_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assignments` ADD CONSTRAINT `fk_assignments_class` FOREIGN KEY (`organization_id`,`class_id`) REFERENCES `classes`(`organization_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assignments` ADD CONSTRAINT `fk_assignments_creator` FOREIGN KEY (`organization_id`,`created_by_teacher_membership_id`) REFERENCES `organization_memberships`(`organization_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `teacher_observations` ADD CONSTRAINT `fk_obs_author` FOREIGN KEY (`organization_id`,`author_teacher_membership_id`) REFERENCES `organization_memberships`(`organization_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `teacher_observations` ADD CONSTRAINT `fk_obs_student` FOREIGN KEY (`organization_id`,`student_membership_id`) REFERENCES `organization_memberships`(`organization_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `teacher_observations` ADD CONSTRAINT `fk_obs_class` FOREIGN KEY (`organization_id`,`class_id`) REFERENCES `classes`(`organization_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `teacher_observations` ADD CONSTRAINT `fk_obs_assignment` FOREIGN KEY (`organization_id`,`class_id`,`assignment_id`) REFERENCES `assignments`(`organization_id`,`class_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `teacher_observations` ADD CONSTRAINT `fk_obs_attempt_student` FOREIGN KEY (`organization_id`,`student_membership_id`,`attempt_id`) REFERENCES `activity_attempts`(`organization_id`,`student_membership_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `teacher_observations` ADD CONSTRAINT `fk_obs_attempt_assignment` FOREIGN KEY (`organization_id`,`assignment_id`,`student_membership_id`,`attempt_id`) REFERENCES `activity_attempts`(`organization_id`,`assignment_id`,`student_membership_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `org_insight_daily_snapshots` ADD CONSTRAINT `fk_org_insights_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `fk_audit_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `fk_audit_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_org_memberships_user` ON `organization_memberships` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_org_memberships_org_role` ON `organization_memberships` (`organization_id`,`role`,`status`);--> statement-breakpoint
CREATE INDEX `idx_organizations_status` ON `organizations` (`status`);--> statement-breakpoint
CREATE INDEX `idx_sessions_user_active` ON `sessions` (`user_id`,`revoked_at`,`absolute_expires_at`);--> statement-breakpoint
CREATE INDEX `idx_sessions_cleanup` ON `sessions` (`absolute_expires_at`);--> statement-breakpoint
CREATE INDEX `idx_users_status` ON `users` (`status`);--> statement-breakpoint
CREATE INDEX `idx_users_platform_role` ON `users` (`platform_role`);--> statement-breakpoint
CREATE INDEX `idx_enrollments_student` ON `class_enrollments` (`organization_id`,`student_membership_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_enrollments_class_status` ON `class_enrollments` (`organization_id`,`class_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_class_teachers_member` ON `class_teachers` (`organization_id`,`teacher_membership_id`);--> statement-breakpoint
CREATE INDEX `idx_classes_org_status` ON `classes` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_csv_jobs_org_created` ON `csv_import_jobs` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_goals_student_status` ON `student_goals` (`organization_id`,`student_membership_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_goals_class` ON `student_goals` (`organization_id`,`class_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_approvals_version_decision` ON `content_approvals` (`content_version_id`,`decision`);--> statement-breakpoint
CREATE INDEX `idx_content_items_type_archived` ON `content_items` (`content_type`,`is_archived`);--> statement-breakpoint
CREATE INDEX `idx_content_versions_status` ON `content_versions` (`status`,`content_item_id`);--> statement-breakpoint
CREATE INDEX `idx_turns_org_attempt` ON `activity_attempt_turns` (`organization_id`,`attempt_id`);--> statement-breakpoint
CREATE INDEX `idx_attempts_student_status` ON `activity_attempts` (`organization_id`,`student_membership_id`,`status`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_attempts_target_item_status` ON `activity_attempts` (`organization_id`,`assignment_target_id`,`assignment_item_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_assignment_items_assignment` ON `assignment_items` (`organization_id`,`assignment_id`);--> statement-breakpoint
CREATE INDEX `idx_progress_student_status` ON `assignment_progress` (`organization_id`,`student_membership_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_targets_student` ON `assignment_targets` (`organization_id`,`student_membership_id`);--> statement-breakpoint
CREATE INDEX `idx_assignments_class_status` ON `assignments` (`organization_id`,`class_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_assignments_creator` ON `assignments` (`organization_id`,`created_by_teacher_membership_id`);--> statement-breakpoint
CREATE INDEX `idx_obs_author_student` ON `teacher_observations` (`organization_id`,`author_teacher_membership_id`,`student_membership_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_org_insights_org_date` ON `org_insight_daily_snapshots` (`organization_id`,`period_type`,`snapshot_date`);--> statement-breakpoint
CREATE INDEX `idx_audit_org_created` ON `audit_logs` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_event_created` ON `audit_logs` (`event_type`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_actor` ON `audit_logs` (`actor_user_id`,`created_at`);