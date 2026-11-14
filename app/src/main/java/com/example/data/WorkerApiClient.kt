package com.example.data

import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class WorkerApiClient {
  private val client = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(20, TimeUnit.SECONDS)
    .build()

  private val jsonMedia = "application/json; charset=utf-8".toMediaType()

  suspend fun checkHealth(baseUrl: String): Result<String> = withContext(Dispatchers.IO) {
    runCatching {
      val req = Request.Builder().url("${baseUrl.trimEnd('/')}/health").get().build()
      client.newCall(req).execute().use { resp ->
        val body = resp.body?.string() ?: ""
        if (!resp.isSuccessful) error("HTTP ${resp.code}: $body")
        val json = JSONObject(body)
        "${json.optString("service", "Worker")} (${json.optString("env", "prod")})"
      }
    }
  }

  suspend fun login(
    baseUrl: String,
    username: String,
    password: String,
    totpCode: String?,
  ): Result<String> = withContext(Dispatchers.IO) {
    runCatching {
      val payload = JSONObject().apply {
        put("username", username)
        put("password", password)
        if (!totpCode.isNullOrBlank()) put("totpCode", totpCode)
      }
      val req = Request.Builder()
        .url("${baseUrl.trimEnd('/')}/api/admin/auth/login")
        .post(payload.toString().toRequestBody(jsonMedia))
        .build()
      client.newCall(req).execute().use { resp ->
        val body = resp.body?.string() ?: "{}"
        val json = JSONObject(body)
        if (!resp.isSuccessful) error(json.optString("error", "Login failed (${resp.code})"))
        json.getString("token")
      }
    }
  }

  suspend fun fetchStats(baseUrl: String, token: String): Result<AdminStats> = withContext(Dispatchers.IO) {
    runCatching {
      val req = Request.Builder()
        .url("${baseUrl.trimEnd('/')}/api/admin/stats")
        .header("Authorization", "Bearer $token")
        .get()
        .build()
      client.newCall(req).execute().use { resp ->
        val body = resp.body?.string() ?: "{}"
        val json = JSONObject(body)
        if (!resp.isSuccessful) error(json.optString("error", "HTTP ${resp.code}"))
        val health = json.optJSONObject("buildServerHealth") ?: JSONObject()
        AdminStats(
          totalUsers = json.optInt("totalUsers"),
          activeUsers = json.optInt("activeUsers"),
          totalZipUploads = json.optInt("totalZipUploads"),
          rejectedZipUploads = json.optInt("rejectedZipUploads"),
          successfulBuilds = json.optInt("successfulBuilds"),
          failedBuilds = json.optInt("failedBuilds"),
          currentBuildQueue = json.optInt("currentBuildQueue"),
          pointsIssued = json.optLong("pointsIssued"),
          freeApkCreditsIssued = json.optInt("freeApkCreditsIssued"),
          totalReferrals = json.optInt("totalReferrals"),
          qualifiedReferrals = json.optInt("qualifiedReferrals"),
          telegramMembershipRewards = json.optInt("telegramMembershipRewards"),
          maintenanceMode = json.optBoolean("maintenanceMode"),
          builderStatus = health.optString("status", "unknown"),
          builderCpuLoad = health.opt("cpuLoad1m")?.toString() ?: "-",
          builderRamFreeMb = health.optInt("ramFreeMb", 0),
          builderDiskFreeGb = health.opt("diskFreeGb")?.toString() ?: "-",
        )
      }
    }
  }

  suspend fun fetchBuilds(baseUrl: String, token: String): Result<List<BuildJobItem>> = withContext(Dispatchers.IO) {
    runCatching {
      val req = Request.Builder()
        .url("${baseUrl.trimEnd('/')}/api/admin/builds")
        .header("Authorization", "Bearer $token")
        .get()
        .build()
      client.newCall(req).execute().use { resp ->
        val body = resp.body?.string() ?: "{}"
        val json = JSONObject(body)
        if (!resp.isSuccessful) error(json.optString("error", "HTTP ${resp.code}"))
        val arr = json.optJSONArray("builds") ?: return@runCatching emptyList()
        buildList {
          for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            add(
              BuildJobItem(
                id = o.getInt("id"),
                jobCode = o.getString("job_code"),
                appName = o.optString("app_name", "App"),
                packageName = o.optString("package_name", ""),
                status = o.getString("status"),
                stage = o.optString("stage", ""),
                progressPercent = o.optInt("progress_percent", 0),
                errorMessage = o.optString("error_message").takeIf { it.isNotBlank() && it != "null" },
                createdAt = o.optString("created_at", ""),
              )
            )
          }
        }
      }
    }
  }

  suspend fun retryOrCancelBuild(baseUrl: String, token: String, jobId: Int, action: String): Result<Unit> =
    withContext(Dispatchers.IO) {
      runCatching {
        val req = Request.Builder()
          .url("${baseUrl.trimEnd('/')}/api/admin/builds/$jobId/$action")
          .header("Authorization", "Bearer $token")
          .post("{}".toRequestBody(jsonMedia))
          .build()
        client.newCall(req).execute().use { resp ->
          val body = resp.body?.string() ?: "{}"
          if (!resp.isSuccessful) error(JSONObject(body).optString("error", "Action failed"))
        }
      }
    }

  suspend fun fetchChannels(baseUrl: String, token: String): Result<List<TelegramChannelItem>> =
    withContext(Dispatchers.IO) {
      runCatching {
        val req = Request.Builder()
          .url("${baseUrl.trimEnd('/')}/api/admin/channels")
          .header("Authorization", "Bearer $token")
          .get()
          .build()
        client.newCall(req).execute().use { resp ->
          val body = resp.body?.string() ?: "{}"
          val json = JSONObject(body)
          if (!resp.isSuccessful) error(json.optString("error", "HTTP ${resp.code}"))
          val arr = json.optJSONArray("channels") ?: return@runCatching emptyList()
          buildList {
            for (i in 0 until arr.length()) {
              val o = arr.getJSONObject(i)
              add(
                TelegramChannelItem(
                  id = o.getInt("id"),
                  name = o.getString("name"),
                  chatId = o.getString("chat_id"),
                  inviteUrl = o.getString("invite_url"),
                  rewardPoints = o.getInt("reward_points"),
                  isActive = o.optInt("is_active", 1) == 1,
                )
              )
            }
          }
        }
      }
    }

  suspend fun addChannel(
    baseUrl: String,
    token: String,
    name: String,
    chatId: String,
    inviteUrl: String,
    rewardPoints: Int,
  ): Result<Unit> = withContext(Dispatchers.IO) {
    runCatching {
      val payload = JSONObject().apply {
        put("name", name)
        put("chatId", chatId)
        put("inviteUrl", inviteUrl)
        put("rewardPoints", rewardPoints)
      }
      val req = Request.Builder()
        .url("${baseUrl.trimEnd('/')}/api/admin/channels")
        .header("Authorization", "Bearer $token")
        .post(payload.toString().toRequestBody(jsonMedia))
        .build()
      client.newCall(req).execute().use { resp ->
        val body = resp.body?.string() ?: "{}"
        if (!resp.isSuccessful) error(JSONObject(body).optString("error", "Failed to add channel"))
      }
    }
  }

  suspend fun fetchAuditLogs(baseUrl: String, token: String): Result<List<AuditLogItem>> =
    withContext(Dispatchers.IO) {
      runCatching {
        val req = Request.Builder()
          .url("${baseUrl.trimEnd('/')}/api/admin/audit-logs")
          .header("Authorization", "Bearer $token")
          .get()
          .build()
        client.newCall(req).execute().use { resp ->
          val body = resp.body?.string() ?: "{}"
          val json = JSONObject(body)
          if (!resp.isSuccessful) error(json.optString("error", "HTTP ${resp.code}"))
          val arr = json.optJSONArray("logs") ?: return@runCatching emptyList()
          buildList {
            for (i in 0 until arr.length()) {
              val o = arr.getJSONObject(i)
              add(
                AuditLogItem(
                  id = o.getInt("id"),
                  actorType = o.optString("actor_type", ""),
                  actorId = o.optString("actor_id", ""),
                  action = o.optString("action", ""),
                  targetType = o.optString("target_type", ""),
                  targetId = o.optString("target_id", ""),
                  reason = o.optString("reason", ""),
                  createdAt = o.optString("created_at", ""),
                )
              )
            }
          }
        }
      }
    }
}
