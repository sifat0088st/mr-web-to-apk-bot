package com.example.data

data class AdminStats(
  val totalUsers: Int,
  val activeUsers: Int,
  val totalZipUploads: Int,
  val rejectedZipUploads: Int,
  val successfulBuilds: Int,
  val failedBuilds: Int,
  val currentBuildQueue: Int,
  val pointsIssued: Long,
  val freeApkCreditsIssued: Int,
  val totalReferrals: Int,
  val qualifiedReferrals: Int,
  val telegramMembershipRewards: Int,
  val maintenanceMode: Boolean,
  val builderStatus: String,
  val builderCpuLoad: String,
  val builderRamFreeMb: Int,
  val builderDiskFreeGb: String,
)

data class BuildJobItem(
  val id: Int,
  val jobCode: String,
  val appName: String,
  val packageName: String,
  val status: String,
  val stage: String,
  val progressPercent: Int,
  val errorMessage: String?,
  val createdAt: String,
)

data class TelegramChannelItem(
  val id: Int,
  val name: String,
  val chatId: String,
  val inviteUrl: String,
  val rewardPoints: Int,
  val isActive: Boolean,
)

data class AuditLogItem(
  val id: Int,
  val actorType: String,
  val actorId: String,
  val action: String,
  val targetType: String,
  val targetId: String,
  val reason: String,
  val createdAt: String,
)

data class ZipScanReport(
  val passed: Boolean,
  val fileName: String,
  val compressedSizeBytes: Long,
  val extractedSizeBytes: Long,
  val fileCount: Int,
  val maxDepth: Int,
  val hasIndexHtml: Boolean,
  val findings: List<String>,
  val approvedFiles: List<String>,
)

data class ConfigValidationResult(
  val isValid: Boolean,
  val errors: List<String>,
)
