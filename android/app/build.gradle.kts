import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release signing: the upload key's details come from android/keystore.properties (never committed)
// or, in CI, from environment variables. See STORE.md.
val signing = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun signingValue(key: String, env: String): String? = signing.getProperty(key) ?: System.getenv(env)
val storePath = signingValue("storeFile", "CLEARWAY_KEYSTORE")

android {
    namespace = "io.github.encycloacid.clearmap"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.encycloacid.clearmap"
        minSdk = 26
        targetSdk = 36
        versionCode = 57
        versionName = "10.2"
    }

    signingConfigs {
        create("upload") {
            if (storePath != null) {
                storeFile = rootProject.file(storePath)
                storePassword = signingValue("storePassword", "CLEARWAY_KEYSTORE_PASSWORD")
                keyAlias = signingValue("keyAlias", "CLEARWAY_KEY_ALIAS")
                keyPassword = signingValue("keyPassword", "CLEARWAY_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            // R8 shrinks the Kotlin code and drops unused resources; the map itself is web assets.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Without an upload key the release build falls back to the debug key, so it still
            // installs for testing; Google Play only accepts it signed with the upload key.
            signingConfig = if (storePath != null) signingConfigs.getByName("upload") else signingConfigs.getByName("debug")
        }
    }

    bundle {
        // one app bundle; Play serves each phone only the language and density it needs
        language { enableSplit = true }
        density { enableSplit = true }
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
    // Google code scanner: a ready-made barcode scanning screen from Play services, with no camera
    // permission needed (the scan happens in Play services). Reads boarding-pass PDF417, Aztec and QR codes.
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
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
