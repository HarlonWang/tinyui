plugins {
    id("tinyui.kmp.library")
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
}

kotlin {
    android {
        namespace = "wang.harlon.tinyui.sample.shared"
        // AGP 的 KMP 库插件默认不处理 res / assets，Compose resources 在 Android 走 assets，必须打开
        androidResources { enable = true }
    }

    listOf(iosArm64(), iosSimulatorArm64()).forEach { target ->
        target.binaries.framework {
            baseName = "Shared"
            isStatic = true
        }
    }

    sourceSets {
        commonMain.dependencies {
            implementation(project(":compose"))
            implementation(compose.runtime)
            implementation(compose.foundation)
            implementation(compose.material3)
            implementation(compose.ui)
            implementation(compose.components.resources)
            implementation(libs.kotlinx.coroutines.core)
        }
    }
}

// JS 侧：pnpm 编三个包 → tinyui build 把 sample/js 的页面与运行时模块编成字节码 → 只把 .bin 与清单打成 Compose 资源
val jsRoot = rootDir.resolve("sample/js")
val cliOut = layout.buildDirectory.dir("tinyui-cli")
val quickjsKmpDir = (gradle as ExtensionAware).extra.properties["quickjs-kmp.dir"] as File?
val qjsc: Provider<String> = providers.gradleProperty("tinyui.qjsc")
    .orElse(providers.environmentVariable("TINYUI_QJSC"))
    .orElse(providers.provider { quickjsKmpDir?.resolve("library/build/native/host-tools/bin/qjsc-kmp")?.absolutePath })

val buildJsPackages by tasks.registering(Exec::class) {
    group = "build"
    description = "pnpm build for packages/*"
    workingDir = rootDir
    commandLine("pnpm", "run", "build")
    inputs.files(fileTree(rootDir.resolve("packages")) { include("*/src/**", "*/package.json", "*/tsconfig.json") })
    inputs.file(rootDir.resolve("tsconfig.base.json"))
    outputs.dirs(rootDir.resolve("packages/core/dist"), rootDir.resolve("packages/native/dist"), rootDir.resolve("packages/cli/dist"))
}

val buildTinyUIPages by tasks.registering(Exec::class) {
    group = "build"
    description = "tinyui build for sample/js"
    dependsOn(buildJsPackages)
    if (quickjsKmpDir != null) dependsOn(gradle.includedBuild("quickjs-kmp").task(":library:buildHostTools"))
    workingDir = jsRoot
    inputs.dir(jsRoot.resolve("src"))
    inputs.files(buildJsPackages.map { it.outputs.files })
    inputs.property("qjsc", qjsc.orElse(""))
    outputs.dir(cliOut)
    val args = mutableListOf("node", rootDir.resolve("packages/cli/dist/bin.js").path, "build", "--root", jsRoot.path, "--out", cliOut.get().asFile.path)
    qjsc.orNull?.let { args += listOf("--qjsc", it) }
    commandLine(args)
}

val collectTinyUIResources by tasks.registering(Sync::class) {
    // maps ride along for the debug-only failure screen (docs/build-chain.md); -Ptinyui.maps=false leaves them out
    from(buildTinyUIPages) {
        include("**/*.bin", "manifest.json")
        if (providers.gradleProperty("tinyui.maps").orNull != "false") include("**/*.js.map")
    }
    into(layout.buildDirectory.dir("tinyui-resources/files/tinyui"))
}

// Compose's assets copy never deletes what an earlier build produced: a removed page would stay in the APK
tasks.matching { it.name.startsWith("copy") && it.name.endsWith("ComposeResourcesToAndroidAssets") }.configureEach {
    doFirst { outputs.files.forEach { it.deleteRecursively() } }
}

compose.resources {
    packageOfResClass = "wang.harlon.tinyui.sample.res"
    customDirectory("commonMain", layout.dir(collectTinyUIResources.map { it.destinationDir.parentFile.parentFile }))
}
