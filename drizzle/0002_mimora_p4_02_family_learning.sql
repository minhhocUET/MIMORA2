CREATE TABLE `student_link_invitation_students` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`invitation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`student_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `student_link_invitation_students_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_inv_students_pair` UNIQUE(`invitation_id`,`student_user_id`)
);
--> statement-breakpoint
CREATE TABLE `family_programs` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`slug` varchar(128) NOT NULL,
	`availability_mode` varchar(32) NOT NULL DEFAULT 'admin_assigned',
	`status` varchar(32) NOT NULL DEFAULT 'draft',
	`current_published_version_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`created_by_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`retired_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `family_programs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_family_programs_slug` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `family_program_versions` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`family_program_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`version_number` int NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'draft',
	`title` varchar(255) NOT NULL,
	`description` text,
	`locale` varchar(16) NOT NULL DEFAULT 'vi',
	`age_band` varchar(64),
	`availability_mode` varchar(32) NOT NULL DEFAULT 'admin_assigned',
	`created_by_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`published_by_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`published_at` datetime(3),
	`retired_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `family_program_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_family_prog_versions_prog_num` UNIQUE(`family_program_id`,`version_number`),
	CONSTRAINT `uq_family_prog_versions_prog_id` UNIQUE(`family_program_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `family_program_items` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`family_program_version_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`chapter_number` int NOT NULL DEFAULT 1,
	`chapter_title` varchar(255) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`content_version_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `family_program_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_family_prog_items_ver_id` UNIQUE(`family_program_version_id`,`id`),
	CONSTRAINT `uq_family_prog_items_ver_content_id` UNIQUE(`family_program_version_id`,`content_version_id`,`id`),
	CONSTRAINT `uq_family_prog_items_order` UNIQUE(`family_program_version_id`,`sort_order`)
);
--> statement-breakpoint
CREATE TABLE `family_program_enrollments` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`family_workspace_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`student_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`family_program_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`family_program_version_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`activation_source` varchar(32) NOT NULL,
	`activated_by_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`learning_status` varchar(32) NOT NULL DEFAULT 'not_started',
	`total_activities` int NOT NULL DEFAULT 0,
	`completed_activities` int NOT NULL DEFAULT 0,
	`started_at` datetime(3),
	`last_activity_at` datetime(3),
	`completed_at` datetime(3),
	`activated_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	`revoked_by_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`active_ws_guard` char(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN status = 'active' THEN family_workspace_id ELSE NULL END) VIRTUAL,
	`active_student_guard` char(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN status = 'active' THEN student_user_id ELSE NULL END) VIRTUAL,
	`active_program_guard` char(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN status = 'active' THEN family_program_id ELSE NULL END) VIRTUAL,
	CONSTRAINT `family_program_enrollments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_family_enrollments_active_triple` UNIQUE(`active_ws_guard`,`active_student_guard`,`active_program_guard`),
	CONSTRAINT `uq_family_enrollments_student_ver_id` UNIQUE(`student_user_id`,`family_program_version_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `family_activity_attempts` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`enrollment_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`family_workspace_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`student_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`family_program_version_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`family_program_item_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
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
	`in_progress_enrollment_guard` char(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN status = 'in_progress' THEN enrollment_id ELSE NULL END) VIRTUAL,
	`in_progress_item_guard` char(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN status = 'in_progress' THEN family_program_item_id ELSE NULL END) VIRTUAL,
	CONSTRAINT `family_activity_attempts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_family_attempts_student_id` UNIQUE(`student_user_id`,`id`),
	CONSTRAINT `uq_family_attempts_number` UNIQUE(`enrollment_id`,`family_program_item_id`,`attempt_number`),
	CONSTRAINT `uq_family_attempts_idempotency` UNIQUE(`enrollment_id`,`family_program_item_id`,`start_idempotency_key`),
	CONSTRAINT `uq_family_attempts_single_in_progress` UNIQUE(`in_progress_enrollment_guard`,`in_progress_item_guard`)
);
--> statement-breakpoint
CREATE TABLE `family_activity_attempt_turns` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`student_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`attempt_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`turn_index` int NOT NULL,
	`step_key` varchar(64) NOT NULL,
	`selected_choice_key` varchar(128),
	`selected_emotion_key` varchar(64),
	`used_aac` boolean NOT NULL DEFAULT false,
	`used_read_aloud` boolean NOT NULL DEFAULT false,
	`response_payload_json` json,
	`responded_at` datetime(3) NOT NULL,
	CONSTRAINT `family_activity_attempt_turns_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_family_turns_attempt_idx` UNIQUE(`attempt_id`,`turn_index`)
);
--> statement-breakpoint
CREATE TABLE `student_family_preferences` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`student_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`preferred_name` varchar(120),
	`support_preferences_json` json,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `student_family_preferences_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_student_family_prefs_user` UNIQUE(`student_user_id`)
);
--> statement-breakpoint
ALTER TABLE `student_link_invitation_students` ADD CONSTRAINT `fk_inv_students_invitation` FOREIGN KEY (`invitation_id`) REFERENCES `student_link_invitations`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `student_link_invitation_students` ADD CONSTRAINT `fk_inv_students_student` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_programs` ADD CONSTRAINT `fk_family_programs_creator` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_program_versions` ADD CONSTRAINT `fk_family_prog_versions_program` FOREIGN KEY (`family_program_id`) REFERENCES `family_programs`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_program_versions` ADD CONSTRAINT `fk_family_prog_versions_creator` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_program_versions` ADD CONSTRAINT `fk_family_prog_versions_publisher` FOREIGN KEY (`published_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_programs` ADD CONSTRAINT `fk_family_programs_pub_version` FOREIGN KEY (`id`,`current_published_version_id`) REFERENCES `family_program_versions`(`family_program_id`,`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `family_program_items` ADD CONSTRAINT `fk_family_prog_items_version` FOREIGN KEY (`family_program_version_id`) REFERENCES `family_program_versions`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_program_items` ADD CONSTRAINT `fk_family_prog_items_content_ver` FOREIGN KEY (`content_version_id`) REFERENCES `content_versions`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_program_enrollments` ADD CONSTRAINT `fk_family_enrollments_workspace` FOREIGN KEY (`family_workspace_id`) REFERENCES `family_workspaces`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_program_enrollments` ADD CONSTRAINT `fk_family_enrollments_student` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_program_enrollments` ADD CONSTRAINT `fk_family_enrollments_program` FOREIGN KEY (`family_program_id`) REFERENCES `family_programs`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_program_enrollments` ADD CONSTRAINT `fk_family_enrollments_prog_version` FOREIGN KEY (`family_program_id`,`family_program_version_id`) REFERENCES `family_program_versions`(`family_program_id`,`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_program_enrollments` ADD CONSTRAINT `fk_family_enrollments_activator` FOREIGN KEY (`activated_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_program_enrollments` ADD CONSTRAINT `fk_family_enrollments_revoker` FOREIGN KEY (`revoked_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_activity_attempts` ADD CONSTRAINT `fk_family_attempts_workspace` FOREIGN KEY (`family_workspace_id`) REFERENCES `family_workspaces`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_activity_attempts` ADD CONSTRAINT `fk_family_attempts_student` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_activity_attempts` ADD CONSTRAINT `fk_family_attempts_enrollment` FOREIGN KEY (`student_user_id`,`family_program_version_id`,`enrollment_id`) REFERENCES `family_program_enrollments`(`student_user_id`,`family_program_version_id`,`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_activity_attempts` ADD CONSTRAINT `fk_family_attempts_item` FOREIGN KEY (`family_program_version_id`,`content_version_id`,`family_program_item_id`) REFERENCES `family_program_items`(`family_program_version_id`,`content_version_id`,`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_activity_attempts` ADD CONSTRAINT `fk_family_attempts_content_ver` FOREIGN KEY (`content_version_id`) REFERENCES `content_versions`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_activity_attempt_turns` ADD CONSTRAINT `fk_family_turns_attempt` FOREIGN KEY (`student_user_id`,`attempt_id`) REFERENCES `family_activity_attempts`(`student_user_id`,`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `student_family_preferences` ADD CONSTRAINT `fk_student_family_prefs_user` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `idx_inv_students_student` ON `student_link_invitation_students` (`student_user_id`);
--> statement-breakpoint
CREATE INDEX `idx_family_programs_status_mode` ON `family_programs` (`status`,`availability_mode`);
--> statement-breakpoint
CREATE INDEX `idx_family_prog_versions_status` ON `family_program_versions` (`family_program_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_family_prog_items_ver_chapter` ON `family_program_items` (`family_program_version_id`,`chapter_number`,`sort_order`);
--> statement-breakpoint
CREATE INDEX `idx_family_enrollments_student_status` ON `family_program_enrollments` (`student_user_id`,`status`,`learning_status`);
--> statement-breakpoint
CREATE INDEX `idx_family_enrollments_ws_student` ON `family_program_enrollments` (`family_workspace_id`,`student_user_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_family_enrollments_program` ON `family_program_enrollments` (`family_program_id`,`family_program_version_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_family_attempts_student_status` ON `family_activity_attempts` (`student_user_id`,`status`,`started_at`);
--> statement-breakpoint
CREATE INDEX `idx_family_attempts_enroll_item_status` ON `family_activity_attempts` (`enrollment_id`,`family_program_item_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_family_turns_student_attempt` ON `family_activity_attempt_turns` (`student_user_id`,`attempt_id`);

-- ============================================================================
-- EXPLICIT ROLLBACK SQL (DO NOT RUN AUTOMATICALLY — REFERENCE ONLY)
-- ============================================================================
-- ALTER TABLE `family_programs` DROP FOREIGN KEY `fk_family_programs_pub_version`;
-- DROP TABLE IF EXISTS `student_family_preferences`;
-- DROP TABLE IF EXISTS `family_activity_attempt_turns`;
-- DROP TABLE IF EXISTS `family_activity_attempts`;
-- DROP TABLE IF EXISTS `family_program_enrollments`;
-- DROP TABLE IF EXISTS `family_program_items`;
-- DROP TABLE IF EXISTS `family_program_versions`;
-- DROP TABLE IF EXISTS `family_programs`;
-- DROP TABLE IF EXISTS `student_link_invitation_students`;
