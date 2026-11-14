package com.example

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.ui.MRWebToApkApp
import com.example.ui.MainViewModel
import com.example.ui.theme.MRWebToApkTheme

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    setContent {
      MRWebToApkTheme {
        val mainViewModel: MainViewModel = viewModel()
        MRWebToApkApp(viewModel = mainViewModel)
      }
    }
  }
}
