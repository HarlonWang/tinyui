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
