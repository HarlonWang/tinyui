plugins {
    id("tinyui.kmp.library")
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
    alias(libs.plugins.kotlinSerialization)
    alias(libs.plugins.vanniktech.mavenPublish)
    alias(libs.plugins.binaryCompatibilityValidator)
}

kotlin {
    android {
        namespace = "wang.harlon.tinyui"
    }

    sourceSets {
        commonMain.dependencies {
            api(libs.quickjs.kmp)
            implementation(compose.runtime)
            implementation(compose.foundation)
            implementation(compose.material3)
            implementation(libs.kotlinx.coroutines.core)
            implementation(libs.kotlinx.serialization.json)
        }
        commonTest.dependencies {
            implementation(libs.kotlin.test)
            implementation(libs.kotlinx.coroutines.test)
        }
    }
}

mavenPublishing {
    publishToMavenCentral()
    if (providers.gradleProperty("signingInMemoryKey").isPresent) {
        signAllPublications()
    }

    coordinates(artifactId = "tinyui")

    pom {
        name.set("TinyUI")
        description.set("JS-driven declarative UI for Compose Multiplatform, powered by QuickJS.")
        url.set("https://github.com/HarlonWang/tinyui")
        licenses {
            license {
                name.set("MIT")
                url.set("https://opensource.org/licenses/MIT")
            }
        }
        developers {
            developer {
                id.set("HarlonWang")
                name.set("Harlon Wang")
            }
        }
        scm {
            url.set("https://github.com/HarlonWang/tinyui")
            connection.set("scm:git:https://github.com/HarlonWang/tinyui.git")
        }
    }
}

apiValidation {
    klib { enabled = true }
}

// Android host test 要加载宿主编译的 libquickjs_kmp：composite 时取 quickjs-kmp 的 buildNativeHostJni 产物，
// 否则读 TINYUI_QUICKJS_HOST_JNI（CI 从 quickjs-kmp 源码现编，见 .github/workflows/build.yml）
val quickjsKmpDir = (gradle as ExtensionAware).extra.properties["quickjs-kmp.dir"] as File?
val hostJniDir: Provider<String> = providers.environmentVariable("TINYUI_QUICKJS_HOST_JNI")
    .orElse(providers.provider { quickjsKmpDir?.resolve("library/build/native/host-jni/lib")?.absolutePath })
tasks.withType<Test>().matching { it.name == "testAndroidHostTest" }.configureEach {
    if (quickjsKmpDir != null) dependsOn(gradle.includedBuild("quickjs-kmp").task(":library:buildNativeHostJni"))
    hostJniDir.orNull?.let { systemProperty("java.library.path", it) }
    // BundleSmokeTest loads the sample's bytecode when it exists: never a stale one from before a rebuild in the same run
    mustRunAfter(":sample:shared:buildTinyUIPages")
}
