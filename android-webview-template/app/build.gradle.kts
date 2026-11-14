import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val appConfigFile = file("app_build_config.properties")
val appProps = Properties().apply {
    if (appConfigFile.exists()) {
        appConfigFile.inputStream().use { load(it) }
    }
}

val cfgApplicationId = appProps.getProperty("applicationId", "com.mrwebtoapk.generated.app")
val cfgVersionCode = appProps.getProperty("versionCode", "1").toInt()
val cfgVersionName = appProps.getProperty("versionName", "1.0.0")
val cfgAppName = appProps.getProperty("appName", "MR WebApp")
val cfgStartPage = appProps.getProperty("startPage", "index.html")
val cfgStatusBarColor = appProps.getProperty("statusBarColor", "#10B981")
val cfgNavBarColor = appProps.getProperty("navBarColor", "#111827")
val cfgAppTheme = appProps.getProperty("appTheme", "system")
val cfgOrientation = appProps.getProperty("orientation", "portrait")
val cfgExternalMode = appProps.getProperty("externalLinksMode", "in_app")
val cfgExternalDomains = appProps.getProperty("externalLinksDomains", "")
val cfgHasSplash = appProps.getProperty("hasSplash", "false")

android {
    namespace = "com.mrwebtoapk.template"
    compileSdk = 34

    defaultConfig {
        applicationId = cfgApplicationId
        minSdk = 24
        targetSdk = 34
        versionCode = cfgVersionCode
        versionName = cfgVersionName

        resValue("string", "app_name", cfgAppName)
        buildConfigField("String", "START_PAGE", "\"$cfgStartPage\"")
        buildConfigField("String", "STATUS_BAR_COLOR", "\"$cfgStatusBarColor\"")
        buildConfigField("String", "NAV_BAR_COLOR", "\"$cfgNavBarColor\"")
        buildConfigField("String", "APP_THEME", "\"$cfgAppTheme\"")
        buildConfigField("String", "SCREEN_ORIENTATION", "\"$cfgOrientation\"")
        buildConfigField("String", "EXTERNAL_LINKS_MODE", "\"$cfgExternalMode\"")
        buildConfigField("String", "EXTERNAL_LINKS_DOMAINS", "\"$cfgExternalDomains\"")
        buildConfigField("boolean", "HAS_SPLASH", cfgHasSplash)
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("com.google.android.material:material:1.12.0")
}
