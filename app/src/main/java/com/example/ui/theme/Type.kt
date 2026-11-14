package com.example.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.example.R

val DisplayFontFamily = FontFamily(Font(R.font.space_grotesk, FontWeight.Bold))
val BodyFontFamily = FontFamily(Font(R.font.plus_jakarta_sans, FontWeight.Normal))
val MonoFontFamily = FontFamily(Font(R.font.jetbrains_mono, FontWeight.Medium))

val Typography = Typography(
  headlineMedium = TextStyle(
    fontFamily = DisplayFontFamily,
    fontWeight = FontWeight.Bold,
    fontSize = 24.sp,
    lineHeight = 30.sp,
  ),
  titleLarge = TextStyle(
    fontFamily = DisplayFontFamily,
    fontWeight = FontWeight.Bold,
    fontSize = 20.sp,
    lineHeight = 26.sp,
  ),
  titleMedium = TextStyle(
    fontFamily = DisplayFontFamily,
    fontWeight = FontWeight.SemiBold,
    fontSize = 16.sp,
    lineHeight = 22.sp,
  ),
  bodyLarge = TextStyle(
    fontFamily = BodyFontFamily,
    fontWeight = FontWeight.Normal,
    fontSize = 15.sp,
    lineHeight = 22.sp,
  ),
  bodyMedium = TextStyle(
    fontFamily = BodyFontFamily,
    fontWeight = FontWeight.Normal,
    fontSize = 13.sp,
    lineHeight = 19.sp,
  ),
  labelLarge = TextStyle(
    fontFamily = DisplayFontFamily,
    fontWeight = FontWeight.SemiBold,
    fontSize = 13.sp,
    lineHeight = 18.sp,
  ),
  labelSmall = TextStyle(
    fontFamily = MonoFontFamily,
    fontWeight = FontWeight.Medium,
    fontSize = 11.sp,
    lineHeight = 15.sp,
  ),
)
