package com.example.ui

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.FolderZip
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.outlined.AdminPanelSettings
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.FolderZip
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.R
import com.example.data.AdminStats
import com.example.data.BuildJobItem
import com.example.data.ZipScanReport

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MRWebToApkApp(viewModel: MainViewModel) {
  val state by viewModel.uiState.collectAsStateWithLifecycle()
  val snackbarHostState = remember { SnackbarHostState() }
  val isBn = state.languageCode == "bn"

  if (state.currentTab != AppTab.OVERVIEW) {
    BackHandler { viewModel.selectTab(AppTab.OVERVIEW) }
  }

  LaunchedEffect(state.statusMessage, state.errorMessage) {
    val msg = state.errorMessage ?: state.statusMessage
    if (msg != null) {
      snackbarHostState.showSnackbar(msg)
      viewModel.clearMessages()
    }
  }

  val navItems = listOf(
    Triple(AppTab.OVERVIEW, if (isBn) "ওভারভিউ" else stringResource(R.string.nav_overview), Pair(Icons.Filled.Dashboard, Icons.Outlined.Dashboard)),
    Triple(AppTab.BUILDS, if (isBn) "বিল্ড" else stringResource(R.string.nav_builds), Pair(Icons.Filled.Build, Icons.Outlined.Build)),
    Triple(AppTab.ZIP_SCANNER, if (isBn) "ZIP স্ক্যান" else stringResource(R.string.nav_scanner), Pair(Icons.Filled.FolderZip, Icons.Outlined.FolderZip)),
    Triple(AppTab.ADMIN, if (isBn) "অ্যাডমিন" else stringResource(R.string.nav_admin), Pair(Icons.Filled.AdminPanelSettings, Icons.Outlined.AdminPanelSettings)),
  )

  BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
    val useRail = maxWidth >= 600.dp

    Row(modifier = Modifier.fillMaxSize()) {
      if (useRail) {
        NavigationRail(
          containerColor = MaterialTheme.colorScheme.surface,
          modifier = Modifier.fillMaxHeight(),
        ) {
          Spacer(Modifier.height(16.dp))
          navItems.forEach { (tab, label, icons) ->
            NavigationRailItem(
              selected = state.currentTab == tab,
              onClick = { viewModel.selectTab(tab) },
              icon = { Icon(if (state.currentTab == tab) icons.first else icons.second, contentDescription = label) },
              label = { Text(label) },
              modifier = Modifier.testTag("nav_${tab.name.lowercase()}"),
            )
          }
        }
      }

      Scaffold(
        modifier = Modifier.weight(1f),
        contentWindowInsets = WindowInsets.navigationBars,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
          TopAppBar(
            title = {
              Column {
                Text(stringResource(R.string.brand_full_title), style = MaterialTheme.typography.titleMedium)
                Text(
                  stringResource(R.string.brand_subtitle),
                  style = MaterialTheme.typography.labelSmall,
                  color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
              }
            },
            colors = TopAppBarDefaults.topAppBarColors(
              containerColor = MaterialTheme.colorScheme.surface,
            ),
            actions = {
              IconButton(
                onClick = { viewModel.toggleLanguage() },
                modifier = Modifier.minimumInteractiveComponentSize().testTag("language_toggle_button"),
              ) {
                Icon(Icons.Filled.Language, contentDescription = "Toggle Bengali / English")
              }
              if (state.adminToken.isNotBlank()) {
                IconButton(
                  onClick = { viewModel.refreshAll() },
                  modifier = Modifier.minimumInteractiveComponentSize().testTag("refresh_all_button"),
                ) {
                  Icon(Icons.Filled.Refresh, contentDescription = "Refresh Worker data")
                }
              }
            },
          )
        },
        bottomBar = {
          if (!useRail) {
            NavigationBar(
              containerColor = MaterialTheme.colorScheme.surface,
              windowInsets = WindowInsets.navigationBars,
            ) {
              navItems.forEach { (tab, label, icons) ->
                NavigationBarItem(
                  selected = state.currentTab == tab,
                  onClick = { viewModel.selectTab(tab) },
                  icon = { Icon(if (state.currentTab == tab) icons.first else icons.second, contentDescription = label) },
                  label = { Text(label) },
                  modifier = Modifier.testTag("nav_${tab.name.lowercase()}"),
                )
              }
            }
          }
        },
      ) { innerPadding ->
        Box(
          modifier = Modifier
            .fillMaxSize()
            .padding(innerPadding),
          contentAlignment = Alignment.TopCenter,
        ) {
          Column(
            modifier = Modifier
              .fillMaxSize()
              .widthIn(max = 760.dp),
          ) {
            if (state.isLoading) {
              LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }
            when (state.currentTab) {
              AppTab.OVERVIEW -> OverviewScreen(state, isBn, onOpenAdmin = { viewModel.selectTab(AppTab.ADMIN) }, onOpenScanner = { viewModel.selectTab(AppTab.ZIP_SCANNER) })
              AppTab.BUILDS -> BuildsScreen(state, isBn, onAction = viewModel::performBuildAction, onConnect = { viewModel.selectTab(AppTab.ADMIN) })
              AppTab.ZIP_SCANNER -> ZipScannerScreen(state, isBn, onPickZip = viewModel::scanPickedZip, onValidateConfig = viewModel::validateAppConfiguration)
              AppTab.ADMIN -> AdminScreen(state, isBn, viewModel)
            }
          }
        }
      }
    }
  }
}

@Composable
private fun OverviewScreen(
  state: MainUiState,
  isBn: Boolean,
  onOpenAdmin: () -> Unit,
  onOpenScanner: () -> Unit,
) {
  val context = LocalContext.current

  LazyColumn(
    contentPadding = PaddingValues(16.dp),
    verticalArrangement = Arrangement.spacedBy(16.dp),
  ) {
    item {
      Box(
        modifier = Modifier
          .fillMaxWidth()
          .clip(RoundedCornerShape(20.dp))
          .background(
            Brush.linearGradient(
              listOf(
                MaterialTheme.colorScheme.secondary,
                MaterialTheme.colorScheme.primaryContainer,
              )
            )
          )
          .padding(20.dp),
      ) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
          Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
              modifier = Modifier
                .size(40.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primary),
              contentAlignment = Alignment.Center,
            ) {
              Icon(Icons.Filled.CloudDone, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimary)
            }
            Column {
              Text(
                if (isBn) "MR WEB TO APK BOT" else "MR WEB TO APK BOT",
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSecondary,
              )
              Text(
                if (isBn) "HTML/CSS/JS/JSON → Signed Android APK" else "24/7 Cloudflare Worker + Docker APK Engine",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSecondary.copy(alpha = 0.85f),
              )
            }
          }

          Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
            Button(
              onClick = {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://t.me/MRWebToApkBot"))
                runCatching { context.startActivity(intent) }
              },
              modifier = Modifier.weight(1f).minimumInteractiveComponentSize().testTag("open_telegram_bot_button"),
              colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
            ) {
              Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, modifier = Modifier.size(18.dp))
              Spacer(Modifier.width(6.dp))
              Text(if (isBn) "টেলিগ্রাম বট" else "Open Bot")
            }
            OutlinedButton(
              onClick = onOpenScanner,
              modifier = Modifier.weight(1f).minimumInteractiveComponentSize().testTag("quick_zip_scan_button"),
            ) {
              Icon(Icons.Filled.Security, contentDescription = null, modifier = Modifier.size(18.dp))
              Spacer(Modifier.width(6.dp))
              Text(if (isBn) "ZIP পরীক্ষা" else "Scan ZIP")
            }
          }
        }
      }
    }

    if (state.stats == null) {
      item {
        Card(
          colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
          elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        ) {
          Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
              if (isBn) "ক্লাউডফ্লেয়ার ওয়ার্কার সংযুক্ত করুন" else "Connect Your Live Cloudflare Worker",
              style = MaterialTheme.typography.titleMedium,
            )
            Text(
              if (isBn) {
                "রিয়েল-টাইম D1 স্ট্যাটাস, বিল্ড কিউ, রেফারেল ও চ্যানেল ম্যানেজ করতে Admin ট্যাব থেকে আপনার Worker URL দিয়ে সাইন ইন করুন।"
              } else {
                "Sign in from the Admin tab with your deployed Cloudflare Worker URL to view live D1 metrics, build queue status, and Linux Build Server health."
              },
              style = MaterialTheme.typography.bodyMedium,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Button(
              onClick = onOpenAdmin,
              modifier = Modifier.minimumInteractiveComponentSize().testTag("connect_worker_cta"),
            ) {
              Text(if (isBn) "Admin লগইন খুলুন" else "Connect Admin API")
            }
          }
        }
      }
    } else {
      item { StatsGrid(state.stats, isBn) }
    }

    item {
      ArchitectureChecklistCard(isBn)
    }
  }
}

@Composable
private fun StatsGrid(stats: AdminStats, isBn: Boolean) {
  val cards = listOf(
    (if (isBn) "মোট ইউজার" else "Total Users") to stats.totalUsers.toString(),
    (if (isBn) "সক্রিয় ইউজার" else "Active (7d)") to stats.activeUsers.toString(),
    (if (isBn) "সফল APK" else "Successful APKs") to stats.successfulBuilds.toString(),
    (if (isBn) "ব্যর্থ / বাতিল" else "Failed / Rejected") to "${stats.failedBuilds} / ${stats.rejectedZipUploads}",
    (if (isBn) "চলমান কিউ" else "Build Queue") to stats.currentBuildQueue.toString(),
    (if (isBn) "বিল্ড সার্ভার" else "Build Server") to "${stats.builderStatus.uppercase()} (${stats.builderDiskFreeGb} GB free)",
  )
  Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
    cards.chunked(2).forEach { row ->
      Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
        row.forEach { (label, value) ->
          Card(
            modifier = Modifier.weight(1f),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
          ) {
            Column(modifier = Modifier.padding(14.dp)) {
              Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
              Spacer(Modifier.height(4.dp))
              Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
          }
        }
      }
    }
  }
}

@Composable
private fun ArchitectureChecklistCard(isBn: Boolean) {
  Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      Text(
        if (isBn) "প্রোডাকশন সিস্টেম হাইলাইটস" else "Production Architecture Overview",
        style = MaterialTheme.typography.titleMedium,
      )
      val bullets = if (isBn) {
        listOf(
          "• নতুন ইউজার: ১,০০০ পয়েন্ট + ১টি ফ্রি APK ক্রেডিট (একবার)",
          "• রেফারেল: ২৫০ পয়েন্ট এবং প্রতি ১০ রেফারে ২,০০০ পয়েন্ট + ১ ফ্রি ক্রেডিট",
          "• জয়েন অ্যান্ড আর্ন: getChatMember যাচাইয়ে প্রতি চ্যানেলে ৫০০ পয়েন্ট",
          "• Docker বিচ্ছিন্ন লিনাক্স সার্ভারে Gradle বিল্ড ও apksigner সাইনিং",
        )
      } else {
        listOf(
          "• Webhook-driven Cloudflare Worker + D1 + R2 + Queues + Cron",
          "• Atomic credit priority (Free Credit first, else 1,000 pts) + single refund",
          "• Isolated Docker Android SDK 34 compilation + apksigner verification",
          "• Strict ZIP security scan (blocks PHP/SQL/symlinks/traversal/ZIP bombs)",
        )
      }
      bullets.forEach { line ->
        Text(line, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
  }
}

@Composable
private fun BuildsScreen(
  state: MainUiState,
  isBn: Boolean,
  onAction: (Int, String) -> Unit,
  onConnect: () -> Unit,
) {
  if (state.adminToken.isBlank()) {
    EmptyAuthNotice(isBn, onConnect)
    return
  }

  if (state.builds.isEmpty()) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
      Text(if (isBn) "কোনো বিল্ড জব পাওয়া যায়নি।" else "No build jobs recorded yet.")
    }
    return
  }

  LazyColumn(
    contentPadding = PaddingValues(16.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    items(state.builds, key = { it.id }) { job ->
      BuildJobCard(job, onAction)
    }
  }
}

@Composable
private fun BuildJobCard(job: BuildJobItem, onAction: (Int, String) -> Unit) {
  Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f)) {
          Text(job.appName, style = MaterialTheme.typography.titleMedium)
          Text("${job.packageName} • ${job.jobCode}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Surface(
          color = if (job.status == "completed") MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
          shape = RoundedCornerShape(50),
        ) {
          Text(
            job.status.uppercase(),
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            style = MaterialTheme.typography.labelSmall,
          )
        }
      }
      LinearProgressIndicator(progress = { job.progressPercent / 100f }, modifier = Modifier.fillMaxWidth())
      Text("${job.stage} (${job.progressPercent}%)", style = MaterialTheme.typography.bodyMedium)
      job.errorMessage?.let {
        Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
      }
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (job.status == "failed") {
          Button(onClick = { onAction(job.id, "retry") }, modifier = Modifier.minimumInteractiveComponentSize()) {
            Text("Retry")
          }
        }
        if (job.status == "queued" || job.status == "processing") {
          OutlinedButton(onClick = { onAction(job.id, "cancel") }, modifier = Modifier.minimumInteractiveComponentSize()) {
            Text("Cancel & Refund")
          }
        }
      }
    }
  }
}

@Composable
private fun ZipScannerScreen(
  state: MainUiState,
  isBn: Boolean,
  onPickZip: (Uri) -> Unit,
  onValidateConfig: (String, String, String, String, String) -> Unit,
) {
  val zipPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
    if (uri != null) onPickZip(uri)
  }

  var appName by rememberSaveable { mutableStateOf("My Shop App") }
  var packageName by rememberSaveable { mutableStateOf("com.mrwebtoapk.myshop") }
  var versionCode by rememberSaveable { mutableStateOf("1") }
  var statusHex by rememberSaveable { mutableStateOf("#10B981") }
  var navHex by rememberSaveable { mutableStateOf("#111827") }

  LazyColumn(
    contentPadding = PaddingValues(16.dp),
    verticalArrangement = Arrangement.spacedBy(16.dp),
  ) {
    item {
      Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
          Text(
            if (isBn) "অফলাইন ZIP নিরাপত্তা প্রি-চেক" else "On-Device Website ZIP Security Scanner",
            style = MaterialTheme.typography.titleMedium,
          )
          Text(
            if (isBn) {
              "টেলিগ্রাম বটে পাঠানোর আগে আপনার HTML/CSS/JS/JSON ZIP ফাইলটি যাচাই করুন।"
            } else {
              "Select a local .zip website bundle to verify index.html, file extensions, path traversal, magic bytes, and extracted size before uploading to @MRWebToApkBot."
            },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
          Button(
            onClick = { zipPicker.launch(arrayOf("application/zip", "application/x-zip-compressed", "*/*")) },
            modifier = Modifier.fillMaxWidth().minimumInteractiveComponentSize().testTag("pick_zip_button"),
          ) {
            Icon(Icons.Filled.FolderZip, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.pick_zip_button))
          }
          state.zipReport?.let { ZipReportCard(it) }
        }
      }
    }

    item {
      Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
          Text(
            if (isBn) "অ্যাপ ফর্ম ভ্যালিডেটর" else "APK Form Pre-Flight Validator",
            style = MaterialTheme.typography.titleMedium,
          )
          OutlinedTextField(value = appName, onValueChange = { appName = it }, label = { Text("App Name") }, modifier = Modifier.fillMaxWidth())
          OutlinedTextField(value = packageName, onValueChange = { packageName = it }, label = { Text("Package Name") }, modifier = Modifier.fillMaxWidth())
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(value = versionCode, onValueChange = { versionCode = it }, label = { Text("Version Code") }, modifier = Modifier.weight(1f))
            OutlinedTextField(value = statusHex, onValueChange = { statusHex = it }, label = { Text("Status Hex") }, modifier = Modifier.weight(1f))
            OutlinedTextField(value = navHex, onValueChange = { navHex = it }, label = { Text("Nav Hex") }, modifier = Modifier.weight(1f))
          }
          Button(
            onClick = { onValidateConfig(appName, packageName, versionCode, statusHex, navHex) },
            modifier = Modifier.fillMaxWidth().minimumInteractiveComponentSize().testTag("validate_form_button"),
          ) {
            Text(if (isBn) "কনফিগারেশন যাচাই করুন" else "Validate APK Metadata")
          }
          state.configValidation?.let { res ->
            if (res.isValid) {
              Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Text("All APK metadata fields are valid!", color = MaterialTheme.colorScheme.primary)
              }
            } else {
              res.errors.forEach { err ->
                Text("• $err", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
              }
            }
          }
        }
      }
    }
  }
}

@Composable
private fun ZipReportCard(report: ZipScanReport) {
  Surface(
    color = if (report.passed) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.errorContainer,
    shape = RoundedCornerShape(12.dp),
    modifier = Modifier.fillMaxWidth(),
  ) {
    Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(
          if (report.passed) Icons.Filled.CheckCircle else Icons.Filled.ErrorOutline,
          contentDescription = null,
        )
        Text(
          if (report.passed) "PASSED: ${report.fileName}" else "REJECTED: ${report.fileName}",
          style = MaterialTheme.typography.titleMedium,
        )
      }
      Text("Files: ${report.fileCount} | Extracted: ${report.extractedSizeBytes / 1024} KB | Depth: ${report.maxDepth} | index.html: ${report.hasIndexHtml}")
      report.findings.forEach { f ->
        Text("• $f", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
      }
    }
  }
}

@Composable
private fun AdminScreen(
  state: MainUiState,
  isBn: Boolean,
  viewModel: MainViewModel,
) {
  var workerUrl by rememberSaveable(state.workerUrl) { mutableStateOf(state.workerUrl) }
  var username by rememberSaveable { mutableStateOf("") }
  var password by rememberSaveable { mutableStateOf("") }
  var totp by rememberSaveable { mutableStateOf("") }

  var chName by rememberSaveable { mutableStateOf("") }
  var chChatId by rememberSaveable { mutableStateOf("") }
  var chUrl by rememberSaveable { mutableStateOf("") }
  var chReward by rememberSaveable { mutableStateOf("500") }

  LazyColumn(
    contentPadding = PaddingValues(16.dp),
    verticalArrangement = Arrangement.spacedBy(16.dp),
  ) {
    item {
      Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
          Text(stringResource(R.string.connect_worker_title), style = MaterialTheme.typography.titleMedium)
          OutlinedTextField(
            value = workerUrl,
            onValueChange = { workerUrl = it },
            label = { Text("Worker Base URL (https://...workers.dev)") },
            modifier = Modifier.fillMaxWidth().testTag("worker_url_input"),
          )
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
              onClick = { viewModel.checkWorkerHealth(workerUrl) },
              modifier = Modifier.minimumInteractiveComponentSize().testTag("check_health_button"),
            ) {
              Text("Ping /health")
            }
            if (state.adminToken.isNotBlank()) {
              OutlinedButton(
                onClick = { viewModel.disconnectSession() },
                modifier = Modifier.minimumInteractiveComponentSize().testTag("logout_button"),
              ) {
                Text("Sign Out")
              }
            }
          }
          if (state.adminToken.isBlank()) {
            OutlinedTextField(value = username, onValueChange = { username = it }, label = { Text("Admin Username") }, modifier = Modifier.fillMaxWidth().testTag("admin_username_input"))
            OutlinedTextField(value = password, onValueChange = { password = it }, label = { Text("Password") }, modifier = Modifier.fillMaxWidth().testTag("admin_password_input"))
            OutlinedTextField(value = totp, onValueChange = { totp = it }, label = { Text("2FA TOTP Code (optional)") }, modifier = Modifier.fillMaxWidth())
            Button(
              onClick = { viewModel.loginToWorker(workerUrl, username, password, totp) },
              modifier = Modifier.fillMaxWidth().minimumInteractiveComponentSize().testTag("admin_login_button"),
            ) {
              Text(if (isBn) "অ্যাডমিন সাইন ইন" else "Sign In to Worker Admin API")
            }
          }
        }
      }
    }

    if (state.adminToken.isNotBlank()) {
      item {
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
          Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(if (isBn) "জয়েন অ্যান্ড আর্ন চ্যানেল যোগ করুন" else "Add Join & Earn Channel / Group", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(value = chName, onValueChange = { chName = it }, label = { Text("Channel / Group Name") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = chChatId, onValueChange = { chChatId = it }, label = { Text("Chat ID (-100... or @username)") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = chUrl, onValueChange = { chUrl = it }, label = { Text("Invite URL (https://t.me/...)") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = chReward, onValueChange = { chReward = it }, label = { Text("Reward Points") }, modifier = Modifier.fillMaxWidth())
            Button(
              onClick = {
                viewModel.addJoinEarnChannel(chName, chChatId, chUrl, chReward.toIntOrNull() ?: 500)
                chName = ""
                chChatId = ""
                chUrl = ""
              },
              modifier = Modifier.fillMaxWidth().minimumInteractiveComponentSize().testTag("add_channel_button"),
            ) {
              Text("Add Channel")
            }
            if (state.channels.isNotEmpty()) {
              HorizontalDivider()
              state.channels.forEach { ch ->
                Text("• ${ch.name} (${ch.chatId}) — ${ch.rewardPoints} pts [${if (ch.isActive) "Active" else "Off"}]")
              }
            }
          }
        }
      }

      if (state.auditLogs.isNotEmpty()) {
        item {
          Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
              Text(if (isBn) "সাম্প্রতিক অডিট লগ" else "Recent Audit & Security Logs", style = MaterialTheme.typography.titleMedium)
              state.auditLogs.take(12).forEach { log ->
                Text(
                  "${log.action} (${log.actorType}:${log.actorId}) — ${log.reason}",
                  style = MaterialTheme.typography.bodyMedium,
                )
              }
            }
          }
        }
      }
    }
  }
}

@Composable
private fun EmptyAuthNotice(isBn: Boolean, onConnect: () -> Unit) {
  Box(modifier = Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Text(
        if (isBn) "বিল্ড কিউ দেখতে Admin ট্যাব থেকে Worker-এ লগইন করুন।" else "Connect to your Cloudflare Worker in the Admin tab to view live builds.",
        style = MaterialTheme.typography.bodyLarge,
      )
      Button(onClick = onConnect, modifier = Modifier.minimumInteractiveComponentSize()) {
        Text(if (isBn) "Admin ট্যাবে যান" else "Open Admin Connect")
      }
    }
  }
}
