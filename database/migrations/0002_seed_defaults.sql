-- MR WEB TO APK BOT - Default Roles, Permissions, and Configurable Settings

INSERT OR IGNORE INTO admin_roles (id, name, description) VALUES
(1, 'super_admin', 'Full unrestricted administrative access'),
(2, 'moderator', 'User support, build monitoring, and channel management'),
(3, 'viewer', 'Read-only access to statistics, builds, and audit logs');

INSERT OR IGNORE INTO admin_permissions (role_id, permission_key) VALUES
(1, 'users.read'), (1, 'users.ban'), (1, 'users.adjust_balance'),
(1, 'builds.read'), (1, 'builds.manage'),
(1, 'channels.read'), (1, 'channels.manage'),
(1, 'settings.read'), (1, 'settings.manage'),
(1, 'admins.read'), (1, 'admins.manage'),
(1, 'audit.read'),
(2, 'users.read'), (2, 'users.ban'),
(2, 'builds.read'), (2, 'builds.manage'),
(2, 'channels.read'), (2, 'channels.manage'),
(2, 'audit.read'),
(3, 'users.read'), (3, 'builds.read'), (3, 'channels.read'), (3, 'audit.read');

INSERT OR IGNORE INTO app_settings (key, value, value_type, description) VALUES
('maintenance_mode', 'false', 'boolean', 'When true, pauses new APK build submissions with a maintenance notice'),
('welcome_points', '1000', 'number', 'One-time welcome points granted to new users'),
('welcome_credits', '1', 'number', 'One-time free APK build credits granted to new users'),
('build_cost_points', '1000', 'number', 'Point cost per APK build when no free credit is available'),
('referral_reward_points', '250', 'number', 'Points awarded to referrer when referred user qualifies'),
('referral_milestone_interval', '10', 'number', 'Number of qualified referrals per milestone'),
('referral_milestone_points', '2000', 'number', 'Bonus points awarded at each referral milestone'),
('referral_milestone_credits', '1', 'number', 'Bonus free APK credits awarded at each referral milestone'),
('referral_qualification_event', 'first_zip_validated', 'string', 'Event required to qualify a referral: first_zip_validated | first_build_completed | account_created'),
('max_zip_bytes', '26214400', 'number', 'Maximum uploaded website ZIP size in bytes (25 MB)'),
('max_extracted_bytes', '62914560', 'number', 'Maximum extracted website size in bytes (60 MB)'),
('max_file_count', '500', 'number', 'Maximum number of files inside uploaded website ZIP'),
('max_directory_depth', '10', 'number', 'Maximum nested folder depth allowed inside ZIP'),
('max_build_duration_sec', '300', 'number', 'Maximum Gradle APK compilation timeout in seconds'),
('signing_mode', 'platform_managed', 'string', 'Signing identity mode: platform_managed or user_provided'),
('bot_username', 'MRWebToApkBot', 'string', 'Telegram bot username without @ used for referral links'),
('support_contact', '@MRWebToApkSupport', 'string', 'Support handle shown in Help & Support'),
('build_server_last_heartbeat', '', 'string', 'ISO timestamp of the latest build server health heartbeat'),
('build_server_health_json', '{}', 'json', 'Latest CPU, RAM, disk, and Docker status from external build server');
