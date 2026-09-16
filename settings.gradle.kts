import java.util.Properties

pluginManagement {
    includeBuild("build-logic")
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "tinyui"

include(":compose")
include(":sample:shared")
include(":sample:androidApp")

// 本地联调 quickjs-kmp：local.properties 写 quickjs-kmp.dir=<仓路径> 即从源码构建，
// 坐标 → 项目路径的映射由该仓 gradle/composite-substitutions 声明；CI 没有 local.properties，解析 Maven 版本。
val localProperties = file("local.properties").takeIf { it.exists() }?.let { f ->
    Properties().apply { f.inputStream().use { load(it) } }
}
localProperties?.getProperty("quickjs-kmp.dir")?.let { dir ->
    val sdkDir = file(dir)
    require(sdkDir.isDirectory) { "quickjs-kmp.dir 不存在: $sdkDir" }
    includeBuild(sdkDir) {
        dependencySubstitution {
            sdkDir.resolve("gradle/composite-substitutions").readLines()
                .map { it.substringBefore('#').trim() }
                .filter { it.isNotEmpty() }
                .forEach { line ->
                    val (coordinate, projectPath) = line.split("=", limit = 2).map(String::trim)
                    substitute(module(coordinate)).using(project(projectPath))
                }
        }
    }
}
