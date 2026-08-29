plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.sogyboi.inspirationboard.capture"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.sogyboi.inspirationboard.capture"
        minSdk = 26
        targetSdk = 35
        versionCode = 6
        versionName = "0.5.2"
    }

    buildTypes {
        release {
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
}
