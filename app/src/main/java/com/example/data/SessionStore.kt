package com.example.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "mr_web_to_apk_prefs")

class SessionStore(private val context: Context) {
  private val keyWorkerUrl = stringPreferencesKey("worker_url")
  private val keyAdminToken = stringPreferencesKey("admin_token")
  private val keyLanguage = stringPreferencesKey("language_code")

  val workerUrl: Flow<String> = context.dataStore.data.map { it[keyWorkerUrl] ?: "" }
  val adminToken: Flow<String> = context.dataStore.data.map { it[keyAdminToken] ?: "" }
  val languageCode: Flow<String> = context.dataStore.data.map { it[keyLanguage] ?: "en" }

  suspend fun saveConnection(url: String, token: String) {
    context.dataStore.edit { prefs ->
      prefs[keyWorkerUrl] = url.trim().trimEnd('/')
      prefs[keyAdminToken] = token
    }
  }

  suspend fun clearToken() {
    context.dataStore.edit { prefs ->
      prefs.remove(keyAdminToken)
    }
  }

  suspend fun setLanguage(lang: String) {
    context.dataStore.edit { prefs ->
      prefs[keyLanguage] = lang
    }
  }
}
