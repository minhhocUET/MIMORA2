ALTER TABLE `users` ADD COLUMN `email_verified_at` datetime(3);
--> statement-breakpoint
CREATE TABLE `email_verification_tokens` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`purpose` varchar(64) NOT NULL,
	`email_snapshot` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
	`token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`consumed_at` datetime(3),
	`revoked_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `email_verification_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_email_verif_tokens_hash` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `family_workspaces` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`code` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`name` varchar(255) NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`created_by_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `family_workspaces_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_family_workspaces_code` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `family_memberships` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`family_workspace_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`guardian_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`role` varchar(32) NOT NULL DEFAULT 'guardian',
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`invited_by_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`revoked_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`active_workspace_guard` char(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN status = 'active' THEN family_workspace_id ELSE NULL END) VIRTUAL,
	`active_guardian_guard` char(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN status = 'active' THEN guardian_user_id ELSE NULL END) VIRTUAL,
	CONSTRAINT `family_memberships_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_family_memberships_ws_id` UNIQUE(`family_workspace_id`,`id`),
	CONSTRAINT `uq_family_memberships_active_pair` UNIQUE(`active_workspace_guard`,`active_guardian_guard`)
);
--> statement-breakpoint
CREATE TABLE `family_students` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`family_workspace_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`student_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`family_username` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`created_by_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `family_students_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_family_students_ws_student` UNIQUE(`family_workspace_id`,`student_user_id`),
	CONSTRAINT `uq_family_students_ws_username` UNIQUE(`family_workspace_id`,`family_username`)
);
--> statement-breakpoint
CREATE TABLE `student_link_invitations` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`invitation_type` varchar(32) NOT NULL,
	`student_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`source_organization_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`source_family_workspace_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'pending',
	`expires_at` datetime(3) NOT NULL,
	`created_by_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`created_by_role` varchar(32) NOT NULL,
	`claimed_by_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`claimed_family_workspace_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`claimed_at` datetime(3),
	`revoked_by_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`revoked_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `student_link_invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_student_link_invitations_hash` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `guardian_student_links` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`family_workspace_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`guardian_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`student_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`relationship_status` varchar(32) NOT NULL DEFAULT 'active',
	`verification_source` varchar(32) NOT NULL,
	`source_organization_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`invitation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`verified_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	`revoked_by_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`active_ws_guard` char(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN relationship_status = 'active' THEN family_workspace_id ELSE NULL END) VIRTUAL,
	`active_guardian_guard` char(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN relationship_status = 'active' THEN guardian_user_id ELSE NULL END) VIRTUAL,
	`active_student_guard` char(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN relationship_status = 'active' THEN student_user_id ELSE NULL END) VIRTUAL,
	CONSTRAINT `guardian_student_links_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_gs_links_active_triple` UNIQUE(`active_ws_guard`,`active_guardian_guard`,`active_student_guard`)
);
--> statement-breakpoint
ALTER TABLE `email_verification_tokens` ADD CONSTRAINT `fk_email_verif_tokens_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_workspaces` ADD CONSTRAINT `fk_family_workspaces_creator` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_memberships` ADD CONSTRAINT `fk_family_memberships_workspace` FOREIGN KEY (`family_workspace_id`) REFERENCES `family_workspaces`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_memberships` ADD CONSTRAINT `fk_family_memberships_guardian` FOREIGN KEY (`guardian_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_memberships` ADD CONSTRAINT `fk_family_memberships_inviter` FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_students` ADD CONSTRAINT `fk_family_students_workspace` FOREIGN KEY (`family_workspace_id`) REFERENCES `family_workspaces`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_students` ADD CONSTRAINT `fk_family_students_user` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `family_students` ADD CONSTRAINT `fk_family_students_creator` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `student_link_invitations` ADD CONSTRAINT `fk_student_invitations_student` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `student_link_invitations` ADD CONSTRAINT `fk_student_invitations_source_org` FOREIGN KEY (`source_organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `student_link_invitations` ADD CONSTRAINT `fk_student_invitations_source_ws` FOREIGN KEY (`source_family_workspace_id`) REFERENCES `family_workspaces`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `student_link_invitations` ADD CONSTRAINT `fk_student_invitations_creator` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `student_link_invitations` ADD CONSTRAINT `fk_student_invitations_claimer` FOREIGN KEY (`claimed_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `student_link_invitations` ADD CONSTRAINT `fk_student_invitations_claimed_ws` FOREIGN KEY (`claimed_family_workspace_id`) REFERENCES `family_workspaces`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `student_link_invitations` ADD CONSTRAINT `fk_student_invitations_revoker` FOREIGN KEY (`revoked_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `guardian_student_links` ADD CONSTRAINT `fk_gs_links_workspace` FOREIGN KEY (`family_workspace_id`) REFERENCES `family_workspaces`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `guardian_student_links` ADD CONSTRAINT `fk_gs_links_guardian` FOREIGN KEY (`guardian_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `guardian_student_links` ADD CONSTRAINT `fk_gs_links_student` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `guardian_student_links` ADD CONSTRAINT `fk_gs_links_source_org` FOREIGN KEY (`source_organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `guardian_student_links` ADD CONSTRAINT `fk_gs_links_invitation` FOREIGN KEY (`invitation_id`) REFERENCES `student_link_invitations`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `guardian_student_links` ADD CONSTRAINT `fk_gs_links_revoker` FOREIGN KEY (`revoked_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `idx_email_verif_tokens_user_active` ON `email_verification_tokens` (`user_id`,`purpose`,`revoked_at`,`consumed_at`);
--> statement-breakpoint
CREATE INDEX `idx_email_verif_tokens_expires` ON `email_verification_tokens` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `idx_family_workspaces_status` ON `family_workspaces` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_family_memberships_guardian` ON `family_memberships` (`guardian_user_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_family_students_user_status` ON `family_students` (`student_user_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_student_invitations_student_status` ON `student_link_invitations` (`student_user_id`,`status`,`expires_at`);
--> statement-breakpoint
CREATE INDEX `idx_student_invitations_ws_status` ON `student_link_invitations` (`source_family_workspace_id`,`status`,`expires_at`);
--> statement-breakpoint
CREATE INDEX `idx_gs_links_guardian_status` ON `guardian_student_links` (`guardian_user_id`,`relationship_status`);
--> statement-breakpoint
CREATE INDEX `idx_gs_links_student_status` ON `guardian_student_links` (`student_user_id`,`relationship_status`);
