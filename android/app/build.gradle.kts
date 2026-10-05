plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "io.github.encycloacid.clearmap"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.encycloacid.clearmap"
        minSdk = 26
        targetSdk = 35
        versionCode = 11
        versionName = "3.6"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signed with the debug key so the release APK installs without extra setup.
            // Replace with your own signing config before publishing to Google Play.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/webAssets"))
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}

// Copy the shared web map (../../index.html) into the APK's assets, swapping the
// Google Fonts link for the bundled offline copies.
val copyWebAssets by tasks.registering(Sync::class) {
    from(rootProject.file("../index.html")) {
        filter { line ->
            if (line.contains("fonts.googleapis.com") || line.contains("fonts.gstatic.com")) {
                if (line.contains("rel=\"stylesheet\"")) "<link rel=\"stylesheet\" href=\"fonts/fonts.css\">" else ""
            } else line
        }
    }
    from(rootProject.file("fonts")) { into("fonts") }
    into(layout.buildDirectory.dir("generated/webAssets"))
}
tasks.named("preBuild") { dependsOn(copyWebAssets) }
