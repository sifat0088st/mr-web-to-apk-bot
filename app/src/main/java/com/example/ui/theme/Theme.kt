package com.example.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColorScheme = darkColorScheme(
  primary = EmeraldPrimary,
  onPrimary = DarkCharcoal,
  primaryContainer = EmeraldContainerDark,
  onPrimaryContainer = EmeraldSoft,
  secondary = Color(0xFF34D399),
  onSecondary = DarkCharcoal,
  background = DarkCharcoal,
  onBackground = Color(0xFFF8FAFC),
  surface = DarkSurface,
  onSurface = Color(0xFFF8FAFC),
  surfaceVariant = DarkSurfaceVariant,
  onSurfaceVariant = Color(0xFFCBD5E1),
  error = Color(0xFFF87171),
)

private val LightColorScheme = lightColorScheme(
  primary = EmeraldPrimary,
  onPrimary = Color.White,
  primaryContainer = EmeraldSoft,
  onPrimaryContainer = EmeraldContainerDark,
  secondary = DarkCharcoal,
  onSecondary = Color.White,
  background = LightBackground,
  onBackground = DarkCharcoal,
  surface = LightSurface,
  onSurface = DarkCharcoal,
  surfaceVariant = LightSurfaceVariant,
  onSurfaceVariant = SlateMuted,
  error = ErrorRed,
)

@Composable
fun MRWebToApkTheme(
  darkTheme: Boolean = isSystemInDarkTheme(),
  content: @Composable () -> Unit,
) {
  val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme
  MaterialTheme(
    colorScheme = colorScheme,
    typography = Typography,
    content = content,
  )
}
