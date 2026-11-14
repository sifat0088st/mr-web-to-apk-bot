package com.example.ui

import android.app.Application
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.data.AdminStats
import com.example.data.AuditLogItem
import com.example.data.BuildJobItem
import com.example.data.ConfigValidationResult
import com.example.data.SessionStore
import com.example.data.TelegramChannelItem
import com.example.data.WorkerApiClient
import com.example.data.ZipInspector
import com.example.data.ZipScanReport
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class AppTab {
  OVERVIEW,
  BUILDS,
  ZIP_SCANNER,
  ADMIN,
}

data class MainUiState(
  val currentTab: AppTab = AppTab.OVERVIEW,
  val languageCode: String = "en",
  val workerUrl: String = "",
  val adminToken: String = "",
  val isLoading: Boolean = false,
  val statusMessage: String? = null,
  val errorMessage: String? = null,
  val stats: AdminStats? = null,
  val builds: List<BuildJobItem> = emptyList(),
  val channels: List<TelegramChannelItem> = emptyList(),
  val auditLogs: List<AuditLogItem> = emptyList(),
  val zipReport: ZipScanReport? = null,
  val configValidation: ConfigValidationResult? = null,
)

class MainViewModel(application: Application) : AndroidViewModel(application) {
  private val store = SessionStore(application)
  private val api = WorkerApiClient()

  private val _uiState = MutableStateFlow(MainUiState())
  val uiState: StateFlow<MainUiState> = _uiState.asStateFlow()

  init {
    viewModelScope.launch {
      val savedUrl = store.workerUrl.first()
      val savedToken = store.adminToken.first()
      val savedLang = store.languageCode.first()
      _uiState.update {
        it.copy(workerUrl = savedUrl, adminToken = savedToken, languageCode = savedLang)
      }
      if (savedUrl.isNotBlank() && savedToken.isNotBlank()) {
        refreshAll()
      }
    }
  }

  fun selectTab(tab: AppTab) {
    _uiState.update { it.copy(currentTab = tab, errorMessage = null) }
  }

  fun toggleLanguage() {
    val next = if (_uiState.value.languageCode == "en") "bn" else "en"
    _uiState.update { it.copy(languageCode = next) }
    viewModelScope.launch { store.setLanguage(next) }
  }

  fun clearMessages() {
    _uiState.update { it.copy(statusMessage = null, errorMessage = null) }
  }

  fun loginToWorker(url: String, username: String, password: String, totpCode: String) {
    val cleanUrl = url.trim().trimEnd('/')
    if (!cleanUrl.startsWith("https://") && !cleanUrl.startsWith("http://")) {
      _uiState.update { it.copy(errorMessage = "Enter a valid http(s):// Cloudflare Worker URL.") }
      return
    }
    viewModelScope.launch {
      _uiState.update { it.copy(isLoading = true, errorMessage = null, statusMessage = null) }
      api.login(cleanUrl, username.trim(), password, totpCode.trim().ifBlank { null })
        .onSuccess { token ->
          store.saveConnection(cleanUrl, token)
          _uiState.update {
            it.copy(
              isLoading = false,
              workerUrl = cleanUrl,
              adminToken = token,
              statusMessage = "Connected to Cloudflare Worker Admin API",
            )
          }
          refreshAll()
        }
        .onFailure { err ->
          _uiState.update { it.copy(isLoading = false, errorMessage = err.message ?: "Login failed") }
        }
    }
  }

  fun checkWorkerHealth(url: String) {
    val cleanUrl = url.trim().trimEnd('/')
    if (cleanUrl.isBlank()) return
    viewModelScope.launch {
      _uiState.update { it.copy(isLoading = true, errorMessage = null) }
      api.checkHealth(cleanUrl)
        .onSuccess { info ->
          _uiState.update { it.copy(isLoading = false, statusMessage = "Health OK: $info") }
        }
        .onFailure { err ->
          _uiState.update { it.copy(isLoading = false, errorMessage = err.message ?: "Health check failed") }
        }
    }
  }

  fun disconnectSession() {
    viewModelScope.launch {
      store.clearToken()
      _uiState.update {
        it.copy(
          adminToken = "",
          stats = null,
          builds = emptyList(),
          channels = emptyList(),
          auditLogs = emptyList(),
          statusMessage = "Signed out",
        )
      }
    }
  }

  fun refreshAll() {
    val url = _uiState.value.workerUrl
    val token = _uiState.value.adminToken
    if (url.isBlank() || token.isBlank()) return
    viewModelScope.launch {
      _uiState.update { it.copy(isLoading = true, errorMessage = null) }
      val statsRes = api.fetchStats(url, token)
      val buildsRes = api.fetchBuilds(url, token)
      val channelsRes = api.fetchChannels(url, token)
      val auditRes = api.fetchAuditLogs(url, token)

      _uiState.update { state ->
        state.copy(
          isLoading = false,
          stats = statsRes.getOrNull() ?: state.stats,
          builds = buildsRes.getOrNull() ?: state.builds,
          channels = channelsRes.getOrNull() ?: state.channels,
          auditLogs = auditRes.getOrNull() ?: state.auditLogs,
          errorMessage = statsRes.exceptionOrNull()?.message,
        )
      }
    }
  }

  fun performBuildAction(jobId: Int, action: String) {
    val url = _uiState.value.workerUrl
    val token = _uiState.value.adminToken
    if (url.isBlank() || token.isBlank()) return
    viewModelScope.launch {
      _uiState.update { it.copy(isLoading = true, errorMessage = null) }
      api.retryOrCancelBuild(url, token, jobId, action)
        .onSuccess {
          _uiState.update { it.copy(statusMessage = "Build #$jobId: $action succeeded") }
          refreshAll()
        }
        .onFailure { err ->
          _uiState.update { it.copy(isLoading = false, errorMessage = err.message) }
        }
    }
  }

  fun addJoinEarnChannel(name: String, chatId: String, inviteUrl: String, rewardPoints: Int) {
    val url = _uiState.value.workerUrl
    val token = _uiState.value.adminToken
    if (url.isBlank() || token.isBlank()) return
    viewModelScope.launch {
      _uiState.update { it.copy(isLoading = true, errorMessage = null) }
      api.addChannel(url, token, name.trim(), chatId.trim(), inviteUrl.trim(), rewardPoints)
        .onSuccess {
          _uiState.update { it.copy(statusMessage = "Channel '$name' added to Join & Earn") }
          refreshAll()
        }
        .onFailure { err ->
          _uiState.update { it.copy(isLoading = false, errorMessage = err.message) }
        }
    }
  }

  fun scanPickedZip(uri: Uri) {
    val ctx = getApplication<Application>()
    viewModelScope.launch(Dispatchers.IO) {
      _uiState.update { it.copy(isLoading = true, errorMessage = null) }
      runCatching {
        var displayName = "website.zip"
        var fileSize = 0L
        ctx.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
          val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
          if (cursor.moveToFirst()) {
            if (nameIdx >= 0) displayName = cursor.getString(nameIdx) ?: displayName
            if (sizeIdx >= 0) fileSize = cursor.getLong(sizeIdx)
          }
        }
        ctx.contentResolver.openInputStream(uri)?.use { stream ->
          ZipInspector.scanZipStream(stream, displayName, fileSize)
        } ?: error("Unable to open selected ZIP archive")
      }.onSuccess { report ->
        _uiState.update { it.copy(isLoading = false, zipReport = report) }
      }.onFailure { err ->
        _uiState.update { it.copy(isLoading = false, errorMessage = err.message ?: "ZIP scan failed") }
      }
    }
  }

  fun validateAppConfiguration(
    appName: String,
    packageName: String,
    versionCode: String,
    statusBarHex: String,
    navBarHex: String,
  ) {
    val result = ZipInspector.validateAppForm(appName, packageName, versionCode, statusBarHex, navBarHex)
    _uiState.update { it.copy(configValidation = result) }
  }
}
